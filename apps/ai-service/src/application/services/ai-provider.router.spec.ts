import { AIErrorCode, AIProviderFailure } from "../errors/ai.errors";
import type { AIRequest, AIResponse } from "../ports/ai-provider.port";
import { MessageRole } from "../../modules/ai/domain/enums/ai.enums";
import { FakeAIProvider } from "../../testing/fake-ai.provider";
import { AIProviderRetryPolicy } from "./ai-provider-retry.policy";
import { AIProviderRegistry, AIProviderRouter } from "./ai-provider.router";

const request: AIRequest = {
  messages: [{ role: MessageRole.USER, content: "Hello" }],
};
const response = (provider: "ollama" | "cloudflare"): AIResponse => ({
  content: "Hi",
  toolCalls: [],
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  metadata: { provider, model: "test-model", latencyMs: 5 },
});
const noRetry = () =>
  new AIProviderRetryPolicy(
    { maxAttempts: 1, baseDelayMs: 1 },
    { wait: async () => undefined },
    { next: () => 0 },
  );

describe("AIProviderRouter", () => {
  it("routes to the provider selected at startup", async () => {
    const ollama = new FakeAIProvider("ollama");
    const cloudflare = new FakeAIProvider("cloudflare");
    cloudflare.enqueueResponse(response("cloudflare"));
    const router = new AIProviderRouter(
      "cloudflare",
      new AIProviderRegistry([ollama, cloudflare]),
      noRetry(),
    );

    await expect(router.generate(request)).resolves.toEqual(
      response("cloudflare"),
    );
    expect(cloudflare.requests).toEqual([request]);
    expect(ollama.requests).toEqual([]);
  });

  it("does not fall back to another provider after a failure", async () => {
    const ollama = new FakeAIProvider("ollama");
    const cloudflare = new FakeAIProvider("cloudflare");
    ollama.enqueueError(new AIProviderFailure("unavailable", "offline", false));
    cloudflare.enqueueResponse(response("cloudflare"));
    const router = new AIProviderRouter(
      "ollama",
      new AIProviderRegistry([ollama, cloudflare]),
      noRetry(),
    );

    await expect(router.generate(request)).rejects.toMatchObject({
      code: AIErrorCode.AI_PROVIDER_UNAVAILABLE,
    });
    expect(ollama.requests).toHaveLength(1);
    expect(cloudflare.requests).toHaveLength(0);
  });

  it("fails fast when the configured provider is not registered", () => {
    expect(
      () =>
        new AIProviderRouter(
          "cloudflare",
          new AIProviderRegistry([new FakeAIProvider("ollama")]),
          noRetry(),
        ),
    ).toThrow("not registered");
  });

  it("rejects duplicate provider registrations", () => {
    expect(
      () =>
        new AIProviderRegistry([
          new FakeAIProvider("ollama"),
          new FakeAIProvider("ollama"),
        ]),
    ).toThrow("Duplicate");
  });
});
