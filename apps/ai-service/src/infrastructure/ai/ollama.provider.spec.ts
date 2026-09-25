import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AIErrorCode } from "../../application/errors/ai.errors";
import type { AIProviderConfig } from "../../application/ports/ai-provider.port";
import { MessageRole } from "../../modules/ai/domain/enums/ai.enums";
import { OllamaProvider } from "./ollama.provider";

const baseConfig: AIProviderConfig = {
  provider: "ollama",
  model: "test-model",
  baseUrl: "http://127.0.0.1:11434",
  timeoutMs: 500,
  maxOutputTokens: 128,
  maxContextMessages: 10,
  retryMaxAttempts: 1,
  retryBaseDelayMs: 1,
};

const response = {
  model: "test-model",
  done: true,
  done_reason: "stop",
  message: { role: "assistant", content: "Hello" },
  prompt_eval_count: 4,
  eval_count: 2,
};

describe("OllamaProvider HTTP contract", () => {
  let server: Server;
  let baseUrl: string;
  let received: { path: string; body?: unknown }[];
  let handler: (
    path: string,
    body: unknown,
  ) =>
    | { status?: number; body: unknown }
    | Promise<{ status?: number; body: unknown }>;

  beforeEach(async () => {
    received = [];
    handler = () => ({ body: response });
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? (JSON.parse(raw) as unknown) : undefined;
      received.push({ path: req.url ?? "", body });
      const result = await handler(req.url ?? "", body);
      res.writeHead(result.status ?? 200, {
        "content-type": "application/json",
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
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("maps messages, tool definitions, text, usage and metadata", async () => {
    const provider = new OllamaProvider({ ...baseConfig, baseUrl });
    const result = await provider.generate({
      messages: [
        { role: MessageRole.SYSTEM, content: "System" },
        { role: MessageRole.USER, content: "Hi" },
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
    expect(received).toEqual([
      {
        path: "/api/chat",
        body: {
          model: "test-model",
          stream: false,
          messages: [
            { role: "system", content: "System" },
            { role: "user", content: "Hi" },
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  type: "function",
                  function: { name: "lookup", arguments: { key: "one" } },
                },
              ],
            },
            { role: "tool", content: "done", tool_name: "lookup" },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "lookup",
                description: "Lookup",
                parameters: { type: "object" },
              },
            },
          ],
          options: { num_predict: 128 },
        },
      },
    ]);
    expect(result).toMatchObject({
      content: "Hello",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      metadata: { provider: "ollama", model: "test-model" },
    });
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("maps valid tool calls and rejects unknown or malformed calls", async () => {
    const provider = new OllamaProvider({ ...baseConfig, baseUrl });
    const tools = [
      {
        name: "lookup",
        description: "Lookup",
        inputSchema: { type: "object" },
      },
    ];
    handler = () => ({
      body: {
        ...response,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            { function: { name: "lookup", arguments: { key: "one" } } },
          ],
        },
      },
    });
    await expect(
      provider.generate({ messages: [], tools }),
    ).resolves.toMatchObject({
      finishReason: "tool_calls",
      content: null,
      toolCalls: [{ name: "lookup", arguments: { key: "one" } }],
    });
    handler = () => ({
      body: {
        ...response,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "other", arguments: {} } }],
        },
      },
    });
    await expect(
      provider.generate({ messages: [], tools }),
    ).rejects.toMatchObject({ code: AIErrorCode.AI_TOOL_CALL_INVALID });
    handler = () => ({
      body: {
        ...response,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "lookup", arguments: "bad" } }],
        },
      },
    });
    await expect(
      provider.generate({ messages: [], tools }),
    ).rejects.toMatchObject({ code: AIErrorCode.AI_TOOL_CALL_INVALID });
  });

  it("maps provider-neutral structured output requests to Ollama format", async () => {
    const provider = new OllamaProvider({ ...baseConfig, baseUrl });
    handler = () => ({
      body: {
        ...response,
        message: { role: "assistant", content: '{"answer":42}' },
      },
    });
    const request = {
      messages: [],
      responseFormat: {
        type: "json_schema" as const,
        schema: { type: "object" },
      },
    };

    await expect(provider.generate(request)).resolves.toMatchObject({
      content: '{"answer":42}',
    });
    expect(received[0].body).toMatchObject({ format: { type: "object" } });
    handler = () => ({ body: response });
    await expect(provider.generate(request)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("reports timeout and connection failures", async () => {
    handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { body: response };
    };
    const slow = new OllamaProvider({ ...baseConfig, baseUrl, timeoutMs: 20 });
    await expect(slow.generate({ messages: [] })).rejects.toMatchObject({
      kind: "timeout",
    });
    const address = baseUrl;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const unavailable = new OllamaProvider({ ...baseConfig, baseUrl: address });
    await expect(unavailable.generate({ messages: [] })).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("rejects invalid JSON, incomplete responses and invalid usage", async () => {
    const provider = new OllamaProvider({ ...baseConfig, baseUrl });
    handler = () => ({ body: "{not json" });
    await expect(provider.generate({ messages: [] })).rejects.toMatchObject({
      kind: "invalid_response",
    });
    handler = () => ({ body: { ...response, done: false } });
    await expect(provider.generate({ messages: [] })).rejects.toMatchObject({
      kind: "invalid_response",
    });
    handler = () => ({ body: { ...response, eval_count: -1 } });
    await expect(provider.generate({ messages: [] })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("checks that the configured model is installed", async () => {
    const provider = new OllamaProvider({ ...baseConfig, baseUrl });
    handler = () => ({ body: { models: [{ name: "test-model:latest" }] } });
    await expect(provider.checkHealth()).resolves.toBeUndefined();
    expect(received[0].path).toBe("/api/tags");
    handler = () => ({ body: { models: [] } });
    await expect(provider.checkHealth()).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
