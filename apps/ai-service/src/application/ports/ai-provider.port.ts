import type { JsonValue } from "@lifehelper/shared-types";
import type { MessageRole } from "../../modules/ai/domain/enums/ai.enums";

export type AIProviderName = "ollama" | "cloudflare";
export type AIJsonObject = { readonly [key: string]: JsonValue };

export interface AIRequestMessage {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: readonly AIToolCall[];
}

export interface AIToolDefinition {
  name: string;
  description: string;
  inputSchema: AIJsonObject;
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: AIJsonObject;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AIProviderMetadata {
  provider: AIProviderName;
  model: string;
  latencyMs: number;
}

export interface AIRequest {
  messages: readonly AIRequestMessage[];
  tools?: readonly AIToolDefinition[];
}

export interface AIResponse {
  content: string | null;
  toolCalls: readonly AIToolCall[];
  usage: AIUsage;
  metadata: AIProviderMetadata;
  finishReason: "stop" | "tool_calls" | "length";
}

export interface AIProvider {
  readonly name: AIProviderName;
  generate(request: AIRequest): Promise<AIResponse>;
  checkHealth(): Promise<void>;
}

export interface AIProviderConfig {
  provider: AIProviderName;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxContextMessages: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
}

export const AI_PROVIDER_CONFIG = Symbol("AI_PROVIDER_CONFIG");
export const AI_PROVIDER_ROUTER = Symbol("AI_PROVIDER_ROUTER");
export const AI_PROVIDER_INSTANCE = Symbol("AI_PROVIDER_INSTANCE");
