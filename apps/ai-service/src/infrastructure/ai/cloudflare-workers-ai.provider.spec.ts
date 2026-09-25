import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  AIErrorCode,
  normalizeAIProviderError,
} from "../../application/errors/ai.errors";
import type { AIProviderConfig } from "../../application/ports/ai-provider.port";
import { AIProviderRetryPolicy } from "../../application/services/ai-provider-retry.policy";
import { MessageRole } from "../../modules/ai/domain/enums/ai.enums";
import { CloudflareWorkersAIProvider } from "./cloudflare-workers-ai.provider";

const config: AIProviderConfig = {
  provider: "cloudflare",
  model: "@cf/test/model",
  baseUrl: "http://127.0.0.1",
  timeoutMs: 500,
  maxOutputTokens: 128,
  maxContextMessages: 10,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 1,
  cloudflareAccountId: "test-account",
  cloudflareApiToken: "test-secret-never-expose",
};
const completion = {
  choices: [
    { message: { role: "assistant", content: "Hello" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
};

describe("CloudflareWorkersAIProvider HTTP contract", () => {
  let server: Server;
  let baseUrl: string;
  let received: {
    path: string;
    method: string;
    authorization?: string;
    body?: unknown;
  }[];
  let handler: () =>
    | { status?: number; body: unknown; headers?: Record<string, string> }
    | Promise<{
        status?: number;
        body: unknown;
        headers?: Record<string, string>;
      }>;

  beforeEach(async () => {
    received = [];
    handler = () => ({ body: completion });
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString();
      received.push({
        path: req.url ?? "",
        method: req.method ?? "",
        authorization: req.headers.authorization,
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      });
      const result = await handler();
      res.writeHead(result.status ?? 200, {
        "content-type": "application/json",
        ...result.headers,
      });
      res.end(
        typeof result.body === "string"
          ? result.body
          : JSON.stringify(result.body),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
  });

  afterEach(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  const provider = (
    baseUrl: string,
    overrides: Partial<AIProviderConfig> = {},
  ) => new CloudflareWorkersAIProvider({ ...config, baseUrl, ...overrides });

  it("sends an authenticated chat request and maps text, usage and safe metadata", async () => {
    const result = await provider(baseUrl).generate({
      messages: [{ role: MessageRole.USER, content: "Hi" }],
    });
    expect(received).toEqual([
      {
        path: "/client/v4/accounts/test-account/ai/v1/chat/completions",
        method: "POST",
        authorization: "Bearer test-secret-never-expose",
        body: {
          model: "@cf/test/model",
          stream: false,
          max_completion_tokens: 128,
          messages: [{ role: "user", content: "Hi" }],
        },
      },
    ]);
    expect(result).toMatchObject({
      content: "Hello",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      metadata: { provider: "cloudflare", model: "@cf/test/model" },
    });
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain(config.cloudflareApiToken);
  });

  it("maps tool definitions, prior tool results and valid function calls", async () => {
    handler = () => ({
      body: {
        ...completion,
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-2",
                  type: "function",
                  function: { name: "lookup", arguments: '{"key":"two"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    const result = await provider(baseUrl).generate({
      messages: [
        {
          role: MessageRole.ASSISTANT,
          content: "",
          toolCalls: [
            { id: "call-1", name: "lookup", arguments: { key: "one" } },
          ],
        },
        { role: MessageRole.TOOL, content: "done", toolCallId: "call-1" },
      ],
      tools: [
        {
          name: "lookup",
          description: "Lookup",
          inputSchema: { type: "object" },
        },
      ],
    });
    expect(result).toMatchObject({
      content: null,
      finishReason: "tool_calls",
      toolCalls: [{ id: "call-2", name: "lookup", arguments: { key: "two" } }],
    });
    expect(received[0].body).toMatchObject({
      tools: [
        {
          type: "function",
          function: { name: "lookup", parameters: { type: "object" } },
        },
      ],
      messages: [
        {
          role: "assistant",
          tool_calls: [
            { id: "call-1", function: { arguments: '{"key":"one"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "done" },
      ],
    });
  });

  it("requests structured JSON and rejects malformed output", async () => {
    const request = {
      messages: [{ role: MessageRole.USER, content: "Hi" }],
      responseFormat: {
        type: "json_schema" as const,
        schema: { type: "object" },
      },
    };
    handler = () => ({
      body: {
        ...completion,
        choices: [
          {
            message: { role: "assistant", content: '{"answer":42}' },
            finish_reason: "stop",
          },
        ],
      },
    });
    await expect(provider(baseUrl).generate(request)).resolves.toMatchObject({
      content: '{"answer":42}',
    });
    expect(received[0].body).toMatchObject({
      response_format: { type: "json_schema", json_schema: { type: "object" } },
    });
    handler = () => ({ body: completion });
    await expect(provider(baseUrl).generate(request)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("rejects duplicate tool-call IDs", async () => {
    const call = {
      id: "same-id",
      type: "function",
      function: { name: "lookup", arguments: "{}" },
    };
    handler = () => ({
      body: {
        ...completion,
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [call, call],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    await expect(
      provider(baseUrl).generate({
        messages: [],
        tools: [
          {
            name: "lookup",
            description: "Lookup",
            inputSchema: { type: "object" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: AIErrorCode.AI_TOOL_CALL_INVALID });
  });

  it.each([
    [401, { error: { code: 10000, message: "secret" } }, "unavailable", false],
    [
      403,
      { errors: [{ code: 5018, message: "secret" }] },
      "unavailable",
      false,
    ],
    [
      403,
      { errors: [{ code: 5035, message: "upgrade" }] },
      "quota_exceeded",
      false,
    ],
    [
      429,
      { errors: [{ code: 3036, message: "upgrade" }] },
      "quota_exceeded",
      false,
    ],
    [429, { errors: [{ code: 3040, message: "busy" }] }, "unavailable", true],
    [503, { errors: [{ code: 3040, message: "busy" }] }, "unavailable", true],
  ] as const)(
    "normalizes HTTP %s without exposing provider body",
    async (status, body, kind, retryable) => {
      handler = () => ({ status, body, headers: { "retry-after": "2" } });
      const error = await provider(baseUrl)
        .generate({ messages: [] })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ kind, retryable });
      const normalized = normalizeAIProviderError(error);
      expect(normalized.message).not.toContain("secret");
      expect(normalized.message).not.toContain("upgrade");
      expect(normalized.message).not.toContain(config.cloudflareApiToken);
      expect(JSON.stringify(normalized)).not.toContain(
        config.cloudflareApiToken,
      );
      if (retryable) expect(error).toMatchObject({ retryAfterMs: 2000 });
    },
  );

  it.each([
    [401, { error: { code: 10000 } }, "unavailable"],
    [429, { errors: [{ code: 3036 }] }, "quota_exceeded"],
  ] as const)(
    "does not retry permanent HTTP %s failures",
    async (status, body, kind) => {
      handler = () => ({ status, body });
      const delay = { wait: jest.fn().mockResolvedValue(undefined) };
      const policy = new AIProviderRetryPolicy(
        { maxAttempts: 3, baseDelayMs: 1 },
        delay,
        { next: () => 0.5 },
      );
      await expect(
        policy.execute(() => provider(baseUrl).generate({ messages: [] })),
      ).rejects.toMatchObject({ kind });
      expect(received).toHaveLength(1);
      expect(delay.wait).not.toHaveBeenCalled();
    },
  );

  it("bounds retries for temporary capacity failures and never changes provider", async () => {
    handler = () => ({ status: 429, body: { errors: [{ code: 3040 }] } });
    const delay = { wait: jest.fn().mockResolvedValue(undefined) };
    const policy = new AIProviderRetryPolicy(
      { maxAttempts: 2, baseDelayMs: 1 },
      delay,
      { next: () => 0.5 },
    );
    await expect(
      policy.execute(() => provider(baseUrl).generate({ messages: [] })),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(received).toHaveLength(2);
    expect(
      received.every((entry) =>
        entry.path.includes("/accounts/test-account/ai/"),
      ),
    ).toBe(true);
  });

  it("reports timeout, malformed JSON, invalid tool calls and failed health checks", async () => {
    handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { body: completion };
    };
    await expect(
      provider(baseUrl, { timeoutMs: 10 }).generate({ messages: [] }),
    ).rejects.toMatchObject({ kind: "timeout" });
    handler = () => ({ body: "{bad" });
    await expect(
      provider(baseUrl).generate({ messages: [] }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
    handler = () => ({
      body: {
        ...completion,
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "x",
                  type: "function",
                  function: { name: "unknown", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    await expect(
      provider(baseUrl).generate({ messages: [], tools: [] }),
    ).rejects.toMatchObject({ code: AIErrorCode.AI_TOOL_CALL_INVALID });
    handler = () => ({
      body: {
        ...completion,
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "x",
                  type: "function",
                  function: { name: "lookup", arguments: "{bad" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    await expect(
      provider(baseUrl).generate({
        messages: [],
        tools: [
          {
            name: "lookup",
            description: "Lookup",
            inputSchema: { type: "object" },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: AIErrorCode.AI_TOOL_CALL_INVALID });
    handler = () => ({ body: { success: true, result: [] } });
    await expect(provider(baseUrl).checkHealth()).resolves.toBeUndefined();
    expect(received.at(-1)?.path).toBe(
      "/client/v4/accounts/test-account/ai/models/search",
    );
  });

  it("normalizes a connection refusal without leaking the token", async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const error = await provider(baseUrl)
      .generate({ messages: [] })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: "unavailable", retryable: true });
    expect(JSON.stringify(normalizeAIProviderError(error))).not.toContain(
      config.cloudflareApiToken,
    );
  });
});
