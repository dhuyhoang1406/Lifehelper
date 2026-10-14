import { DocumentReprocessUseCase } from "./document-reprocess.use-case";
import type { DocumentLifecycleRepository } from "../ports/document-lifecycle.port";

describe("Document reprocess idempotency boundary", () => {
  const reprocess = jest.fn();
  const useCase = new DocumentReprocessUseCase({
    reprocess,
  } as unknown as DocumentLifecycleRepository);
  beforeEach(() => reprocess.mockReset());

  it.each([
    undefined,
    "",
    "custom-key",
    "550e8400e29b41d4a716446655440000",
    "550e8400-e29b-41d4-a716-44665544000g",
  ])("rejects invalid key %s before repository access", (key) => {
    expect(() => useCase.execute("document", "owner", key)).toThrow(
      expect.objectContaining({
        code: "DOCUMENT_IDEMPOTENCY_KEY_INVALID",
        statusCode: 400,
      }),
    );
    expect(reprocess).not.toHaveBeenCalled();
  });

  it("normalizes UUID case and preserves the repository receipt", async () => {
    const receipt = {
      documentId: "document",
      jobId: "job",
      generation: 2,
      status: "PENDING",
    };
    reprocess.mockResolvedValue(receipt);
    await expect(
      useCase.execute(
        "document",
        "owner",
        "550E8400-E29B-41D4-A716-446655440000",
      ),
    ).resolves.toBe(receipt);
    expect(reprocess).toHaveBeenCalledWith(
      "document",
      "owner",
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });
});
