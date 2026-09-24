import { ConfigService } from "@nestjs/config";
import { createAIProviderConfig } from "./ai-provider.config";

function configService(values: Record<string, unknown>): ConfigService {
  return {
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) throw new Error(`Missing configuration: ${key}`);
      return values[key];
    }),
  } as unknown as ConfigService;
}

const commonConfig = {
  AI_MODEL: "test-model",
  AI_BASE_URL: "http://localhost:11434",
  AI_TIMEOUT_MS: 5_000,
  AI_MAX_OUTPUT_TOKENS: 1_024,
  AI_MAX_CONTEXT_MESSAGES: 20,
  AI_RETRY_MAX_ATTEMPTS: 3,
  AI_RETRY_BASE_DELAY_MS: 100,
};

describe("createAIProviderConfig", () => {
  it("builds Ollama configuration without Cloudflare secrets", () => {
    expect(
      createAIProviderConfig(
        configService({ ...commonConfig, AI_PROVIDER: "ollama" }),
      ),
    ).toEqual({
      provider: "ollama",
      model: "test-model",
      baseUrl: "http://localhost:11434",
      timeoutMs: 5_000,
      maxOutputTokens: 1_024,
      maxContextMessages: 20,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 100,
    });
  });

  it("includes Cloudflare credentials only for Cloudflare", () => {
    expect(
      createAIProviderConfig(
        configService({
          ...commonConfig,
          AI_PROVIDER: "cloudflare",
          CLOUDFLARE_ACCOUNT_ID: "account-id",
          CLOUDFLARE_API_TOKEN: "api-token",
        }),
      ),
    ).toMatchObject({
      provider: "cloudflare",
      cloudflareAccountId: "account-id",
      cloudflareApiToken: "api-token",
    });
  });
});
