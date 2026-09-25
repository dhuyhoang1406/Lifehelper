import { CloudflareWorkersAIProvider } from "../src/infrastructure/ai/cloudflare-workers-ai.provider";
import { MessageRole } from "../src/modules/ai/domain/enums/ai.enums";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing ${name} for opt-in Cloudflare smoke test`);
  return value;
}

describe("Cloudflare online smoke test (opt-in)", () => {
  jest.setTimeout(120_000);

  it("generates text through the configured Workers AI account", async () => {
    const baseUrl = required("AI_BASE_URL");
    if (new URL(baseUrl).protocol !== "https:")
      throw new Error("Cloudflare smoke test requires an HTTPS AI_BASE_URL");
    const provider = new CloudflareWorkersAIProvider({
      provider: "cloudflare",
      model: required("AI_MODEL"),
      baseUrl,
      cloudflareAccountId: required("CLOUDFLARE_ACCOUNT_ID"),
      cloudflareApiToken: required("CLOUDFLARE_API_TOKEN"),
      timeoutMs: 60_000,
      maxOutputTokens: 64,
      maxContextMessages: 10,
      retryMaxAttempts: 1,
      retryBaseDelayMs: 250,
    });
    const result = await provider.generate({
      messages: [
        { role: MessageRole.USER, content: "Reply with one short greeting." },
      ],
    });
    expect(result.content).toEqual(expect.any(String));
    expect(result.metadata.provider).toBe("cloudflare");
  });
});
