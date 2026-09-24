import { ConfigService } from "@nestjs/config";
import {
  AI_PROVIDER_CONFIG,
  type AIProviderConfig,
  type AIProviderName,
} from "../application/ports/ai-provider.port";

export { AI_PROVIDER_CONFIG };

export function createAIProviderConfig(
  config: ConfigService,
): AIProviderConfig {
  const provider = config.getOrThrow<AIProviderName>("AI_PROVIDER");
  const common = {
    provider,
    model: config.getOrThrow<string>("AI_MODEL"),
    baseUrl: config.getOrThrow<string>("AI_BASE_URL"),
    timeoutMs: config.getOrThrow<number>("AI_TIMEOUT_MS"),
    maxOutputTokens: config.getOrThrow<number>("AI_MAX_OUTPUT_TOKENS"),
    maxContextMessages: config.getOrThrow<number>("AI_MAX_CONTEXT_MESSAGES"),
    retryMaxAttempts: config.getOrThrow<number>("AI_RETRY_MAX_ATTEMPTS"),
    retryBaseDelayMs: config.getOrThrow<number>("AI_RETRY_BASE_DELAY_MS"),
  };
  if (provider !== "cloudflare") return common;
  return {
    ...common,
    cloudflareAccountId: config.getOrThrow<string>("CLOUDFLARE_ACCOUNT_ID"),
    cloudflareApiToken: config.getOrThrow<string>("CLOUDFLARE_API_TOKEN"),
  };
}
