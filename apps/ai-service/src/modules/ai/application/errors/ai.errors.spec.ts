import {
  AIApplicationError,
  AIErrorCode,
  AIProviderFailure,
  invalidAIToolCall,
  normalizeAIProviderError,
} from "./ai.errors";

describe("AI provider error normalization", () => {
  it.each([
    ["unavailable", AIErrorCode.AI_PROVIDER_UNAVAILABLE, 503],
    ["timeout", AIErrorCode.AI_PROVIDER_TIMEOUT, 504],
    ["quota_exceeded", AIErrorCode.AI_PROVIDER_QUOTA_EXCEEDED, 429],
    ["invalid_response", AIErrorCode.AI_PROVIDER_INVALID_RESPONSE, 502],
  ] as const)("normalizes %s failures", (kind, code, statusCode) => {
    expect(
      normalizeAIProviderError(
        new AIProviderFailure(kind, "provider detail", false),
      ),
    ).toMatchObject({ code, statusCode });
  });

  it("does not expose unknown infrastructure errors", () => {
    const normalized = normalizeAIProviderError(
      new Error("secret upstream response"),
    );

    expect(normalized).toMatchObject({
      code: AIErrorCode.AI_PROVIDER_UNAVAILABLE,
      message: "AI provider is unavailable",
    });
    expect(normalized.message).not.toContain("secret");
  });

  it("preserves an existing application error", () => {
    const error = invalidAIToolCall("Tool arguments are invalid");

    expect(normalizeAIProviderError(error)).toBe(error);
    expect(error).toBeInstanceOf(AIApplicationError);
    expect(error.code).toBe(AIErrorCode.AI_TOOL_CALL_INVALID);
  });
});
