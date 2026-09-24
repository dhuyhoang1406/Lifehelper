export enum AIErrorCode {
  AI_PROVIDER_UNAVAILABLE = "AI_PROVIDER_UNAVAILABLE",
  AI_PROVIDER_TIMEOUT = "AI_PROVIDER_TIMEOUT",
  AI_PROVIDER_QUOTA_EXCEEDED = "AI_PROVIDER_QUOTA_EXCEEDED",
  AI_PROVIDER_INVALID_RESPONSE = "AI_PROVIDER_INVALID_RESPONSE",
  AI_TOOL_CALL_INVALID = "AI_TOOL_CALL_INVALID",
}

export class AIApplicationError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    readonly statusCode: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export type AIProviderFailureKind =
  "unavailable" | "timeout" | "quota_exceeded" | "invalid_response";

export class AIProviderFailure extends Error {
  constructor(
    readonly kind: AIProviderFailureKind,
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

const providerErrorDetails: Record<
  AIProviderFailureKind,
  { code: AIErrorCode; statusCode: number; message: string }
> = {
  unavailable: {
    code: AIErrorCode.AI_PROVIDER_UNAVAILABLE,
    statusCode: 503,
    message: "AI provider is unavailable",
  },
  timeout: {
    code: AIErrorCode.AI_PROVIDER_TIMEOUT,
    statusCode: 504,
    message: "AI provider request timed out",
  },
  quota_exceeded: {
    code: AIErrorCode.AI_PROVIDER_QUOTA_EXCEEDED,
    statusCode: 429,
    message: "AI provider quota is exhausted",
  },
  invalid_response: {
    code: AIErrorCode.AI_PROVIDER_INVALID_RESPONSE,
    statusCode: 502,
    message: "AI provider returned an invalid response",
  },
};

export function normalizeAIProviderError(error: unknown): AIApplicationError {
  if (error instanceof AIApplicationError) return error;
  const failure =
    error instanceof AIProviderFailure
      ? error
      : new AIProviderFailure(
          "unavailable",
          "Unexpected AI provider failure",
          false,
          error,
        );
  const details = providerErrorDetails[failure.kind];
  return new AIApplicationError(
    details.code,
    details.message,
    details.statusCode,
    failure,
  );
}

export const invalidAIToolCall = (message: string, cause?: unknown) =>
  new AIApplicationError(AIErrorCode.AI_TOOL_CALL_INVALID, message, 400, cause);
