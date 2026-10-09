import { chunkText, estimateTokens } from "./text-chunking";
const limits = { targetTokens: 24, overlapTokens: 4, maxChunks: 100 };
it("uses UTF-8 byte budgets rather than equating tokens to characters", () => {
  expect(estimateTokens("Việt")).toBe(6);
  expect(estimateTokens("🙂")).toBe(4);
});
it("prefers paragraphs, preserves physical line references and is reproducible", () => {
  const units = [
    { text: "First paragraph", source: 1 },
    { text: "", source: 2 },
    { text: "Second paragraph", source: 3 },
  ];
  const actual = chunkText(units, "LINE", { ...limits, overlapTokens: 0 });
  expect(actual.map((c) => c.content)).toEqual([
    "First paragraph",
    "Second paragraph",
  ]);
  expect(actual.map((c) => c.locator)).toEqual([
    { kind: "LINE", start: 1, end: 1 },
    { kind: "LINE", start: 3, end: 3 },
  ]);
  expect(chunkText(units, "LINE", { ...limits, overlapTokens: 0 })).toEqual(
    actual,
  );
});
it("retains bounded overlap without duplicate overlap-only chunks", () => {
  const chunks = chunkText(
    [{ text: "one two three four five six seven eight nine", source: 1 }],
    "LINE",
    { targetTokens: 20, overlapTokens: 5, maxChunks: 100 },
  );
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[0].content).toBe("one two three four");
  expect(chunks[1].content.startsWith("four")).toBe(true);
  expect(
    chunks.every(
      (c) => c.tokenCount <= 20 && c.locator.start === 1 && c.locator.end === 1,
    ),
  ).toBe(true);
});
it("splits long Vietnamese words at Unicode code points and keeps page ranges", () => {
  const chunks = chunkText(
    [
      { text: "ệ".repeat(30), source: 1 },
      { text: "end", source: 2 },
    ],
    "PAGE",
    { targetTokens: 12, overlapTokens: 3, maxChunks: 100 },
  );
  expect(
    chunks.every((c) => c.tokenCount <= 12 && !c.content.includes("�")),
  ).toBe(true);
  expect(chunks[chunks.length - 1].locator.end).toBe(2);
  const cross = chunkText(
    [
      { text: "first", source: 1 },
      { text: "second", source: 2 },
    ],
    "PAGE",
    { targetTokens: 32, overlapTokens: 0, maxChunks: 2 },
  );
  expect(cross[0].locator).toEqual({ kind: "PAGE", start: 1, end: 2 });
});
it("bounds chunk count and explicitly rejects empty extraction", () => {
  expect(() =>
    chunkText([{ text: "x".repeat(100), source: 1 }], "LINE", {
      targetTokens: 8,
      overlapTokens: 1,
      maxChunks: 2,
    }),
  ).toThrow("DOCUMENT_CHUNK_LIMIT");
  expect(() => chunkText([{ text: "  ", source: 1 }], "LINE", limits)).toThrow(
    "DOCUMENT_TEXT_EMPTY",
  );
});
