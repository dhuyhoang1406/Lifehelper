import {
  AIApplicationError,
  AIErrorCode,
  AIProviderFailure,
} from "../../application/errors/ai.errors";
import type {
  AIJsonObject,
  AIProvider,
  AIProviderConfig,
  AIRequest,
  AIResponse,
  AIToolCall,
} from "../../application/ports/ai-provider.port";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenCount(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new AIProviderFailure(
      "invalid_response",
      "Invalid token usage",
      false,
    );
  return value as number;
}

function safeUsage(value: Record<string, unknown>): AIJsonObject {
  const safe: Record<string, number | AIJsonObject> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) safe[key] = item;
    else if (isObject(item)) safe[key] = safeUsage(item);
  }
  return safe;
}

function errorCode(payload: unknown): number | undefined {
  if (!isObject(payload)) return undefined;
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const first = errors[0];
  const detail = isObject(payload.error)
    ? payload.error
    : isObject(first)
      ? first
      : payload;
  const code = detail.code;
  if (typeof code === "number" && Number.isSafeInteger(code)) return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return undefined;
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export class CloudflareWorkersAIProvider implements AIProvider {
  readonly name = "cloudflare" as const;
  private readonly apiRoot: URL;
  private readonly token: string;

  constructor(private readonly config: AIProviderConfig) {
    if (!config.cloudflareAccountId || !config.cloudflareApiToken)
      throw new Error("Cloudflare account ID and API token are required");
    this.token = config.cloudflareApiToken;
    const base = new URL(config.baseUrl);
    const path = base.pathname.replace(/\/$/, "");
    base.pathname = `${path}/accounts/${encodeURIComponent(config.cloudflareAccountId)}/ai/`;
    this.apiRoot = base;
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const startedAt = performance.now();
    const payload = await this.request("v1/chat/completions", {
      model: this.config.model,
      stream: false,
      max_completion_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
      ...(request.disableReasoning
        ? { chat_template_kwargs: { enable_thinking: false } }
        : {}),
      messages: this.mapMessages(request),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
      ...(request.responseFormat
        ? {
            response_format: {
              type: "json_schema",
              json_schema: request.responseFormat.schema,
            },
          }
        : {}),
    });
    return this.mapResponse(payload, performance.now() - startedAt, request);
  }

  async checkHealth(): Promise<void> {
    const payload = await this.request("models/search");
    if (
      !isObject(payload) ||
      payload.success !== true ||
      !Array.isArray(payload.result)
    )
      throw new AIProviderFailure(
        "invalid_response",
        "Invalid Cloudflare model list",
        false,
      );
  }

  private mapMessages(request: AIRequest): unknown[] {
    return request.messages
      .slice(-this.config.maxContextMessages)
      .map((message) => {
        if (message.role === "TOOL") {
          if (!message.toolCallId)
            throw new AIApplicationError(
              AIErrorCode.AI_TOOL_CALL_INVALID,
              "Tool result has no call ID",
              400,
            );
          return {
            role: "tool",
            tool_call_id: message.toolCallId,
            content: message.content,
          };
        }
        if (message.role === "ASSISTANT" && message.toolCalls?.length)
          return {
            role: "assistant",
            content: message.content || null,
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            })),
          };
        return { role: message.role.toLowerCase(), content: message.content };
      });
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const url = new URL(path, this.apiRoot);
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        let code: number | undefined;
        try {
          code = errorCode(await response.json());
        } catch {
          /* Ignore untrusted error bodies. */
        }
        const hint = retryAfterMs(response.headers.get("retry-after"));
        if (
          code === 3036 ||
          code === 5035 ||
          (response.status === 429 && code !== 3040)
        )
          throw new AIProviderFailure(
            "quota_exceeded",
            "Cloudflare quota exhausted",
            false,
          );
        if (response.status === 408 || response.status === 504)
          throw new AIProviderFailure(
            "timeout",
            "Cloudflare request timed out",
            true,
            undefined,
            hint,
          );
        if (code === 3040 || response.status >= 500)
          throw new AIProviderFailure(
            "unavailable",
            "Cloudflare temporarily unavailable",
            true,
            undefined,
            hint,
          );
        throw new AIProviderFailure(
          "unavailable",
          "Cloudflare rejected the request",
          false,
        );
      }
      try {
        return await response.json();
      } catch {
        throw new AIProviderFailure(
          "invalid_response",
          "Invalid Cloudflare JSON",
          false,
        );
      }
    } catch (error) {
      if (
        error instanceof AIProviderFailure ||
        error instanceof AIApplicationError
      )
        throw error;
      if (controller.signal.aborted)
        throw new AIProviderFailure(
          "timeout",
          "Cloudflare request timed out",
          true,
        );
      throw new AIProviderFailure(
        "unavailable",
        "Cannot reach Cloudflare",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private mapResponse(
    payload: unknown,
    latencyMs: number,
    request: AIRequest,
  ): AIResponse {
    if (
      !isObject(payload) ||
      !Array.isArray(payload.choices) ||
      !isObject(payload.choices[0])
    )
      throw new AIProviderFailure(
        "invalid_response",
        "Invalid Cloudflare completion",
        false,
      );
    const choice = payload.choices[0];
    if (!isObject(choice.message) || choice.message.role !== "assistant")
      throw new AIProviderFailure(
        "invalid_response",
        "Invalid Cloudflare message",
        false,
      );
    const message = choice.message;
    const rawCalls = message.tool_calls;
    if (rawCalls !== undefined && !Array.isArray(rawCalls))
      throw this.invalidToolCall();
    const allowed = new Set(request.tools?.map((tool) => tool.name) ?? []);
    const seenIds = new Set<string>();
    const toolCalls: AIToolCall[] = (rawCalls ?? []).map((call: unknown) => {
      if (
        !isObject(call) ||
        typeof call.id !== "string" ||
        !call.id ||
        call.type !== "function" ||
        !isObject(call.function) ||
        typeof call.function.name !== "string" ||
        !allowed.has(call.function.name) ||
        typeof call.function.arguments !== "string"
      )
        throw this.invalidToolCall();
      if (seenIds.has(call.id)) throw this.invalidToolCall();
      seenIds.add(call.id);
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        throw this.invalidToolCall();
      }
      if (!isObject(args)) throw this.invalidToolCall();
      return {
        id: call.id,
        name: call.function.name,
        arguments: args as AIJsonObject,
      };
    });
    if (message.content !== null && typeof message.content !== "string")
      throw new AIProviderFailure(
        "invalid_response",
        "Invalid Cloudflare content",
        false,
      );
    const content = message.content || null;
    if (!content && toolCalls.length === 0)
      throw new AIProviderFailure(
        "invalid_response",
        "Empty Cloudflare response",
        false,
      );
    if (request.responseFormat && content) {
      try {
        if (!isObject(JSON.parse(content))) throw new Error();
      } catch {
        throw new AIProviderFailure(
          "invalid_response",
          "Invalid structured output",
          false,
        );
      }
    }
    if (
      choice.finish_reason !== "stop" &&
      choice.finish_reason !== "tool_calls" &&
      choice.finish_reason !== "length"
    )
      throw new AIProviderFailure(
        "invalid_response",
        "Invalid completion finish reason",
        false,
      );
    if (choice.finish_reason === "tool_calls" && toolCalls.length === 0)
      throw this.invalidToolCall();
    if (choice.finish_reason !== "tool_calls" && toolCalls.length > 0)
      throw this.invalidToolCall();
    const usage = isObject(payload.usage) ? payload.usage : {};
    const inputTokens = tokenCount(usage.prompt_tokens);
    const outputTokens = tokenCount(usage.completion_tokens);
    return {
      content,
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: tokenCount(
          usage.total_tokens ?? inputTokens + outputTokens,
        ),
      },
      metadata: {
        provider: this.name,
        model: this.config.model,
        ...(typeof payload.model === "string"
          ? { reportedModel: payload.model }
          : {}),
        latencyMs: Math.max(0, Math.round(latencyMs)),
        rawUsage: safeUsage(usage),
      },
      finishReason: choice.finish_reason,
    };
  }

  private invalidToolCall(): AIApplicationError {
    return new AIApplicationError(
      AIErrorCode.AI_TOOL_CALL_INVALID,
      "AI provider returned an invalid tool call",
      502,
    );
  }
}
