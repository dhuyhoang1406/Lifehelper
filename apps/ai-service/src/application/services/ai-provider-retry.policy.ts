import { AIProviderFailure } from "../errors/ai.errors";
import type { DelayPort, JitterSource } from "../ports/retry.ports";

export interface AIProviderRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

export class AIProviderRetryPolicy {
  constructor(
    private readonly options: AIProviderRetryOptions,
    private readonly delay: DelayPort,
    private readonly jitter: JitterSource,
  ) {
    if (
      !Number.isInteger(options.maxAttempts) ||
      options.maxAttempts < 1 ||
      options.maxAttempts > 5
    ) {
      throw new Error(
        "AI retry max attempts must be an integer between 1 and 5",
      );
    }

    if (
      !Number.isInteger(options.baseDelayMs) ||
      options.baseDelayMs < 1 ||
      options.baseDelayMs > 10_000
    ) {
      throw new Error(
        "AI retry base delay must be an integer between 1 and 10000 milliseconds",
      );
    }
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!this.shouldRetry(error, attempt)) throw error;
        await this.delay.wait(this.backoffDelay(attempt));
      }
    }
    throw new Error("Retry policy exhausted without returning or throwing");
  }

  private shouldRetry(error: unknown, attempt: number): boolean {
    return (
      error instanceof AIProviderFailure &&
      error.retryable &&
      attempt < this.options.maxAttempts
    );
  }

  private backoffDelay(failedAttempt: number): number {
    const exponential =
      this.options.baseDelayMs * Math.pow(2, failedAttempt - 1);
    const jitter = this.jitter.next();
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
      throw new Error("AI retry jitter must be between 0 and 1");
    }
    const jitterFactor = 0.5 + jitter;
    return Math.max(1, Math.round(exponential * jitterFactor));
  }
}
