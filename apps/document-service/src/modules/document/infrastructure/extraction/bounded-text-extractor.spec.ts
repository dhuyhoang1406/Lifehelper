import { BoundedTextExtractor } from "./bounded-text-extractor";
import {
  textPdf,
  encryptedPdf,
  imageOnlyPdf,
} from "../../../../testing/pdf-fixtures";
import type { ExtractionLimits } from "../../application/ports/document-extraction.port";
const limits: ExtractionLimits = {
  maxFileBytes: 100000,
  maxPages: 10,
  maxTextChars: 20000,
  maxExpansionRatio: 100,
  timeoutMs: 4000,
  memoryMb: 128,
};
const signal = () => new AbortController().signal;
const extractor = (overrides: Partial<ExtractionLimits> = {}) =>
  new BoundedTextExtractor({ ...limits, ...overrides });
it("preserves Vietnamese NFC, real line numbers, mixed line endings and markdown as plain text", async () => {
  const result = await extractor().extract(
    Buffer.from("\uFEFFĐiều kiện\r\n\r# Thi\n<script>keep-as-text</script>"),
    "text/markdown",
    signal(),
  );
  expect(result.locatorKind).toBe("LINE");
  expect(result.units).toEqual([
    { text: "Điều kiện", source: 1 },
    { text: "", source: 2 },
    { text: "# Thi", source: 3 },
    { text: "<script>keep-as-text</script>", source: 4 },
  ]);
});
it.each([
  [Buffer.from(" \r\n"), "text/plain", "DOCUMENT_TEXT_EMPTY"],
  [Buffer.from([0xc3, 0x28]), "text/plain", "DOCUMENT_TEXT_INVALID"],
  [Buffer.from("hello\0"), "text/plain", "DOCUMENT_TEXT_INVALID"],
  [Buffer.from("%PDF-not-text"), "text/plain", "DOCUMENT_TEXT_INVALID"],
  [Buffer.from("data"), "image/png", "DOCUMENT_UNSUPPORTED_INPUT"],
  [Buffer.from("%PDF-corrupt"), "application/pdf", "DOCUMENT_PDF_INVALID"],
  [Buffer.from("not pdf"), "application/pdf", "DOCUMENT_PDF_INVALID"],
] as const)(
  "rejects unsupported or invalid bytes with safe errors",
  async (bytes, mime, code) => {
    await expect(
      extractor().extract(bytes, mime, signal()),
    ).rejects.toMatchObject({ code });
  },
);
it("extracts actual multi-page Vietnamese PDF text and physical page locators", async () => {
  const result = await extractor().extract(
    textPdf(["Điều kiện dự thi", "Nộp bài trước hạn"]),
    "application/pdf",
    signal(),
  );
  expect(result.locatorKind).toBe("PAGE");
  expect(result.units.filter((u) => u.text)).toEqual([
    { text: "Điều kiện dự thi", source: 1 },
    { text: "Nộp bài trước hạn", source: 2 },
  ]);
});
it.each(["secret", ""])(
  "rejects encrypted PDFs including ones readable without a password",
  async (password) => {
    await expect(
      extractor().extract(encryptedPdf(password), "application/pdf", signal()),
    ).rejects.toMatchObject({ code: "DOCUMENT_PDF_ENCRYPTED" });
  },
);
it("rejects a real image-only PDF without pretending OCR exists", async () => {
  await expect(
    extractor().extract(imageOnlyPdf(), "application/pdf", signal()),
  ).rejects.toMatchObject({ code: "DOCUMENT_PDF_NO_TEXT" });
});
it("bounds file bytes, page count, text output and compressed expansion", async () => {
  await expect(
    extractor({ maxFileBytes: 3 }).extract(
      Buffer.from("hello"),
      "text/plain",
      signal(),
    ),
  ).rejects.toMatchObject({ code: "DOCUMENT_FILE_LIMIT" });
  await expect(
    extractor({ maxTextChars: 3 }).extract(
      Buffer.from("hello"),
      "text/plain",
      signal(),
    ),
  ).rejects.toMatchObject({ code: "DOCUMENT_TEXT_LIMIT" });
  await expect(
    extractor({ maxPages: 1 }).extract(
      textPdf(["first", "second"]),
      "application/pdf",
      signal(),
    ),
  ).rejects.toMatchObject({ code: "DOCUMENT_PAGE_LIMIT" });
  await expect(
    extractor({ maxExpansionRatio: 1 }).extract(
      textPdf([Array(50).fill("x".repeat(70)).join("\n")], true),
      "application/pdf",
      signal(),
    ),
  ).rejects.toMatchObject({ code: "DOCUMENT_TEXT_LIMIT" });
});
it("terminates the actual PDF worker on timeout/cancellation and permits a subsequent extraction", async () => {
  await expect(
    extractor({ timeoutMs: 1 }).extract(
      textPdf(["hello"]),
      "application/pdf",
      signal(),
    ),
  ).rejects.toMatchObject({ code: "DOCUMENT_PARSER_TIMEOUT" });
  const controller = new AbortController();
  const processing = extractor().extract(
    textPdf(["hello"]),
    "application/pdf",
    controller.signal,
  );
  controller.abort();
  await expect(processing).rejects.toMatchObject({
    code: "DOCUMENT_PARSER_TIMEOUT",
  });
  expect(
    (await extractor().extract(textPdf(["hello"]), "application/pdf", signal()))
      .units[0].text,
  ).toBe("hello");
});
