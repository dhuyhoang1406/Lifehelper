import { AIProviderFailure } from "../errors/ai.errors";
import type { DelayPort, JitterSource } from "../ports/retry.ports";
import { AIProviderRetryPolicy } from "./ai-provider-retry.policy";

class FakeDelay implements DelayPort {
  readonly waits: number[] = [];
  async wait(milliseconds: number): Promise<void> {
    this.waits.push(milliseconds);
  }
}

class FixedJitter implements JitterSource {
  constructor(private readonly value: number) {}
  next(): number {
    return this.value;
  }
}

describe("AIProviderRetryPolicy", () => {
  it.each([
    [{ maxAttempts: 0, baseDelayMs: 100 }, "max attempts"],
    [{ maxAttempts: 6, baseDelayMs: 100 }, "max attempts"],
    [{ maxAttempts: 2, baseDelayMs: 0 }, "base delay"],
    [{ maxAttempts: 2, baseDelayMs: 10_001 }, "base delay"],
  ] as const)("rejects invalid retry options", (options, message) => {
    expect(
      () =>
        new AIProviderRetryPolicy(
          options,
          new FakeDelay(),
          new FixedJitter(0.5),
        ),
    ).toThrow(message);
  });

  it("uses bounded exponential backoff for transient failures", async () => {
    const delay = new FakeDelay();
    const policy = new AIProviderRetryPolicy(
      { maxAttempts: 3, baseDelayMs: 100 },
      delay,
      new FixedJitter(0.5),
    );
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new AIProviderFailure("timeout", "timeout", true))
      .mockRejectedValueOnce(new AIProviderFailure("unavailable", "busy", true))
      .mockResolvedValue("ok");

    await expect(policy.execute(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(delay.waits).toEqual([100, 200]);
  });

  it("does not retry non-transient failures", async () => {
    const delay = new FakeDelay();
    const policy = new AIProviderRetryPolicy(
      { maxAttempts: 3, baseDelayMs: 100 },
      delay,
      new FixedJitter(0.5),
    );
    const error = new AIProviderFailure("invalid_response", "invalid", false);
    const operation = jest.fn().mockRejectedValue(error);

    await expect(policy.execute(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(delay.waits).toEqual([]);
  });

  it("stops after the configured maximum attempts", async () => {
    const delay = new FakeDelay();
    const policy = new AIProviderRetryPolicy(
      { maxAttempts: 2, baseDelayMs: 50 },
      delay,
      new FixedJitter(0),
    );
    const operation = jest
      .fn()
      .mockRejectedValue(new AIProviderFailure("timeout", "timeout", true));

    await expect(policy.execute(operation)).rejects.toMatchObject({
      kind: "timeout",
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(delay.waits).toEqual([25]);
  });

  it("respects a provider retry hint without exceeding the application cap", async () => {
    const delay = new FakeDelay();
    const policy = new AIProviderRetryPolicy(
      { maxAttempts: 3, baseDelayMs: 100 },
      delay,
      new FixedJitter(0.5),
    );
    const operation = jest
      .fn()
      .mockRejectedValueOnce(
        new AIProviderFailure(
          "unavailable",
          "capacity",
          true,
          undefined,
          2_000,
        ),
      )
      .mockRejectedValueOnce(
        new AIProviderFailure(
          "unavailable",
          "capacity",
          true,
          undefined,
          120_000,
        ),
      )
      .mockResolvedValue("ok");

    await expect(policy.execute(operation)).resolves.toBe("ok");
    expect(delay.waits).toEqual([2_000, 30_000]);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid jitter value", async () => {
    const policy = new AIProviderRetryPolicy(
      { maxAttempts: 2, baseDelayMs: 100 },
      new FakeDelay(),
      new FixedJitter(1.1),
    );

    await expect(
      policy.execute(async () => {
        throw new AIProviderFailure("unavailable", "retry", true);
      }),
    ).rejects.toThrow("jitter must be between 0 and 1");
  });
});
