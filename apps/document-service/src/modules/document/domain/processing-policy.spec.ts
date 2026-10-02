import {
  processingFailure,
  retryDelay,
  retryEligible,
} from "./processing-policy";
it("sanitizes unknown errors and does not accept inherited error names", () => {
  expect(processingFailure(new Error("secret document body"))).toBe(
    "DOCUMENT_PROCESSING_UNEXPECTED",
  );
  expect(processingFailure({ code: "constructor" })).toBe(
    "DOCUMENT_PROCESSING_UNEXPECTED",
  );
  expect(processingFailure({ code: "DOCUMENT_STORAGE_TIMEOUT" })).toBe(
    "DOCUMENT_STORAGE_TIMEOUT",
  );
  expect(retryEligible("DOCUMENT_UNSUPPORTED_INPUT")).toBe(false);
  expect(retryEligible("DOCUMENT_PROCESSING_UNAVAILABLE")).toBe(true);
});
it("caps exponential retry delays and applies bounded jitter", () => {
  const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 300 };
  expect(retryDelay(1, policy, () => 0)).toBe(50);
  expect(retryDelay(2, policy, () => 1)).toBe(200);
  expect(retryDelay(100, policy, () => 1)).toBe(300);
});
