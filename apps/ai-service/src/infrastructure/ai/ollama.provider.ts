import { randomUUID } from "node:crypto";
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

export class OllamaProvider implements AIProvider {
  readonly name = "ollama" as const;
  private readonly baseUrl: URL;

  constructor(private readonly config: AIProviderConfig) {
    this.baseUrl = new URL(
      config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`,
    );
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    const startedAt = Date.now();
    const payload = await this.request("api/chat", {
      model: this.config.model,
      stream: false,
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
      options: { num_predict: this.config.maxOutputTokens },
    });
    return this.mapResponse(payload, Date.now() - startedAt, request);
  }

  private mapMessages(request: AIRequest): unknown[] {
    const messages = request.messages.slice(-this.config.maxContextMessages);
    const namesById = new Map<string, string>();
    return messages.map((message) => {
      if (message.role === "ASSISTANT" && message.toolCalls?.length) {
        for (const call of message.toolCalls) namesById.set(call.id, call.name);
        return {
          role: "assistant",
          content: message.content,
          tool_calls: message.toolCalls.map((call) => ({
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        };
      }
      if (message.role === "TOOL") {
        const name =
          message.toolName ?? namesById.get(message.toolCallId ?? "");
        if (!name)
          throw new AIApplicationError(
            AIErrorCode.AI_TOOL_CALL_INVALID,
            "Tool result has no matching tool name",
            400,
          );
        return { role: "tool", tool_name: name, content: message.content };
      }
      return { role: message.role.toLowerCase(), content: message.content };
    });
  }

  async checkHealth(): Promise<void> {
    const payload = await this.request("api/tags");
    if (!isObject(payload) || !Array.isArray(payload.models))
      throw new AIProviderFailure(
        "invalid_response",
        "Invalid model list",
        false,
      );
    const modelAvailable = payload.models.some(
      (entry) =>
        isObject(entry) &&
        typeof entry.name === "string" &&
        (entry.name === this.config.model ||
          entry.name === `${this.config.model}:latest`),
    );
    if (!modelAvailable)
      throw new AIProviderFailure(
        "unavailable",
        "Configured model is not installed",
        false,
      );
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.baseUrl), {
        method: body === undefined ? "GET" : "POST",
        headers:
          body === undefined
            ? undefined
            : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 408 || response.status === 504)
          throw new AIProviderFailure("timeout", "Ollama timed out", true);
        if (response.status === 429)
          throw new AIProviderFailure(
            "quota_exceeded",
            "Ollama rate limit",
            true,
          );
        throw new AIProviderFailure(
          "unavailable",
          `Ollama HTTP ${response.status}`,
          response.status >= 500,
        );
      }
      try {
        return await response.json();
      } catch (error) {
        if (controller.signal.aborted)
          throw new AIProviderFailure(
            "timeout",
            "Ollama request timed out",
            true,
            error,
          );
        throw new AIProviderFailure(
          "invalid_response",
          "Invalid Ollama JSON",
          false,
          error,
        );
      }
    } catch (error) {
      if (error instanceof AIProviderFailure) throw error;
      if (controller.signal.aborted)
        throw new AIProviderFailure(
          "timeout",
          "Ollama request timed out",
          true,
          error,
        );
      throw new AIProviderFailure(
        "unavailable",
        "Cannot reach Ollama",
        true,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapResponse(
    payload: unknown,
    latencyMs: number,
    request: AIRequest,
  ): AIResponse {
    if (
      !isObject(payload) ||
      !isObject(payload.message) ||
      payload.message.role !== "assistant" ||
      typeof payload.message.content !== "string" ||
      typeof payload.model !== "string" ||
      !payload.model.trim() ||
      payload.done !== true
    )
      throw new AIProviderFailure(
        "invalid_response",
        "Invalid Ollama chat response",
        false,
      );

    const rawCalls = payload.message.tool_calls;
    if (rawCalls !== undefined && !Array.isArray(rawCalls))
      throw this.invalidToolCall();
    const allowedTools = new Set(request.tools?.map((tool) => tool.name) ?? []);
    const toolCalls: AIToolCall[] = (rawCalls ?? []).map((raw: unknown) => {
      if (
        !isObject(raw) ||
        !isObject(raw.function) ||
        typeof raw.function.name !== "string" ||
        !raw.function.name.trim() ||
        !allowedTools.has(raw.function.name) ||
        !isObject(raw.function.arguments)
      )
        throw this.invalidToolCall();
      return {
        id: randomUUID(),
        name: raw.function.name,
        arguments: raw.function.arguments as AIJsonObject,
      };
    });
    const inputTokens = tokenCount(payload.prompt_eval_count);
    const outputTokens = tokenCount(payload.eval_count);
    const finishReason =
      toolCalls.length > 0
        ? "tool_calls"
        : payload.done_reason === "length"
          ? "length"
          : "stop";
    return {
      content: payload.message.content || null,
      toolCalls,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      metadata: { provider: this.name, model: payload.model, latencyMs },
      finishReason,
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
