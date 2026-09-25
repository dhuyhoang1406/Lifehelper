import { validateEnvironment } from "./env.validation";

const baseEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:password@localhost:5432/ai",
  REDIS_URL: "redis://localhost:6379",
  AWS_ENDPOINT_URL: "http://localhost:4566",
  AWS_REGION: "ap-southeast-1",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  S3_BUCKET: "test-bucket",
  SQS_QUEUE_NAME: "test-queue",
  AI_PROVIDER: "ollama",
  AI_MODEL: "llama3.2",
  AI_BASE_URL: "http://localhost:11434",
  AI_TIMEOUT_MS: "30000",
  AI_MAX_OUTPUT_TOKENS: "2048",
  AI_MAX_CONTEXT_MESSAGES: "50",
  AI_RETRY_MAX_ATTEMPTS: "3",
  AI_RETRY_BASE_DELAY_MS: "250",
  JWT_ACCESS_SECRET: "test-access-secret-at-least-32-characters",
  JWT_ISSUER: "lifehelper-identity",
  JWT_AUDIENCE: "lifehelper-mobile",
};

describe("AI environment validation", () => {
  it("accepts Ollama without Cloudflare credentials and converts numbers", () => {
    const result = validateEnvironment(baseEnvironment);

    expect(result).toMatchObject({
      AI_PROVIDER: "ollama",
      AI_TIMEOUT_MS: 30000,
      AI_MAX_OUTPUT_TOKENS: 2048,
      AI_MAX_CONTEXT_MESSAGES: 50,
      AI_RETRY_MAX_ATTEMPTS: 3,
      AI_RETRY_BASE_DELAY_MS: 250,
    });
    expect(result).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
  });

  it("accepts Cloudflare only with both required secrets", () => {
    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        AI_PROVIDER: "cloudflare",
        AI_BASE_URL: "https://api.cloudflare.com/client/v4",
        CLOUDFLARE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_API_TOKEN: "api-token",
      }),
    ).not.toThrow();

    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        AI_PROVIDER: "cloudflare",
        AI_BASE_URL: "https://api.cloudflare.com/client/v4",
      }),
    ).toThrow(
      /CLOUDFLARE_ACCOUNT_ID.*required.*CLOUDFLARE_API_TOKEN.*required/,
    );
  });

  it.each([
    ["AI_PROVIDER", "openai"],
    ["AI_BASE_URL", "not-a-url"],
    ["AI_TIMEOUT_MS", "0"],
    ["AI_MAX_OUTPUT_TOKENS", "0"],
    ["AI_MAX_CONTEXT_MESSAGES", "0"],
    ["AI_RETRY_MAX_ATTEMPTS", "6"],
    ["AI_RETRY_BASE_DELAY_MS", "0"],
  ])("rejects invalid %s", (key, value) => {
    expect(() =>
      validateEnvironment({ ...baseEnvironment, [key]: value }),
    ).toThrow("Environment validation failed");
  });
});
