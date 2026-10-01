import { OllamaProvider } from "../src/infrastructure/ai/ollama.provider";
import { MessageRole } from "../src/modules/ai/domain/enums/ai.enums";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for opt-in Ollama smoke test`);
  return value;
}

describe("Ollama online smoke test (opt-in)", () => {
  jest.setTimeout(120_000);
  it("checks the configured model and generates a short reply", async () => {
    const provider = new OllamaProvider({
      provider: "ollama",
      model: required("AI_MODEL"),
      baseUrl: required("AI_BASE_URL"),
      timeoutMs: 60_000,
      maxOutputTokens: 64,
      maxContextMessages: 10,
      retryMaxAttempts: 1,
      retryBaseDelayMs: 250,
    });
    await provider.checkHealth();
    const response = await provider.generate({
      messages: [
        { role: MessageRole.USER, content: "Reply with one short greeting." },
      ],
    });
    expect(response.content).toEqual(expect.any(String));
    expect(response.metadata.provider).toBe("ollama");
  });
});
