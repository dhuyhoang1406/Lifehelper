import { OllamaEmbeddingProvider } from "./ollama-embedding.provider";
const space = {
  model: "fixture:latest",
  version: "a".repeat(64),
  dimensions: 2,
};
const request = {
  space,
  items: [
    { id: "first", text: "Xin chào Việt Nam" },
    { id: "second", text: "Điều kiện dự thi" },
  ],
};
const tags = { models: [{ name: space.model, digest: space.version }] };
let calls: jest.Mock;
beforeEach(() => {
  calls = jest.fn();
  jest.spyOn(global, "fetch").mockImplementation(calls);
});
afterEach(() => jest.restoreAllMocks());
function provider(maxAttempts = 1, timeoutMs = 100) {
  return new OllamaEmbeddingProvider({
    baseUrl: "http://localhost:11434",
    space,
    batchSize: 2,
    maxInputTokens: 128,
    timeoutMs,
    maxAttempts,
  });
}
function reply(
  embeddings: unknown = [
    [1, 0],
    [0, 1],
  ],
) {
  calls
    .mockResolvedValueOnce(Response.json(tags))
    .mockResolvedValueOnce(Response.json({ model: space.model, embeddings }))
    .mockResolvedValueOnce(Response.json(tags));
}
it("pins digest before/after embedding and maps each returned vector to input order without truncation", async () => {
  reply();
  const result = await provider().embed(request, new AbortController().signal);
  expect(result.items).toEqual([
    { id: "first", vector: [1, 0] },
    { id: "second", vector: [0, 1] },
  ]);
  const [url, init] = calls.mock.calls[1];
  expect(url.pathname).toBe("/api/embed");
  expect(init.redirect).toBe("error");
  expect(JSON.parse(init.body)).toMatchObject({
    model: space.model,
    input: request.items.map((i) => i.text),
    truncate: false,
  });
  expect(calls).toHaveBeenCalledTimes(3);
});
it.each([
  { name: "cardinality", vectors: [[1, 0]] },
  { name: "dimensions", vectors: [[1], [0, 1]] },
  {
    name: "zero",
    vectors: [
      [0, 0],
      [0, 1],
    ],
  },
  {
    name: "overflow",
    vectors: [
      [1e100, 0],
      [0, 1],
    ],
  },
  {
    name: "non-numeric",
    vectors: [
      [null, 0],
      [0, 1],
    ],
  },
])("rejects malformed vector batch $name", async ({ vectors }) => {
  reply(vectors);
  await expect(
    provider().embed(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_RESULT_INVALID" });
});
it("rejects incompatible digest before sending private text", async () => {
  calls.mockResolvedValue(
    Response.json({ models: [{ name: space.model, digest: "changed" }] }),
  );
  await expect(
    provider().embed(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_MODEL_MISMATCH" });
  expect(calls).toHaveBeenCalledTimes(1);
});
it("rejects a model tag changed while inference was in progress", async () => {
  calls
    .mockResolvedValueOnce(Response.json(tags))
    .mockResolvedValueOnce(
      Response.json({
        model: space.model,
        embeddings: [
          [1, 0],
          [0, 1],
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ models: [{ name: space.model, digest: "changed" }] }),
    );
  await expect(
    provider().embed(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_MODEL_MISMATCH" });
});
it("retries transient quota errors a bounded number of times without leaking response bodies", async () => {
  calls.mockImplementation(
    async () => new Response("private content", { status: 429 }),
  );
  await expect(
    provider(2).embed(request, new AbortController().signal),
  ).rejects.toMatchObject({
    code: "DOCUMENT_EMBEDDING_QUOTA",
    message: "DOCUMENT_EMBEDDING_QUOTA",
  });
  expect(calls).toHaveBeenCalledTimes(2);
});
it("bounds a stalled response body, not only response headers", async () => {
  calls
    .mockReset()
    .mockResolvedValueOnce(Response.json(tags))
    .mockImplementationOnce(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init.signal.addEventListener(
                "abort",
                () => controller.error(new Error("timeout")),
                { once: true },
              );
            },
          }),
        ),
    );
  const keepAlive = setTimeout(() => undefined, 1000);
  try {
    await expect(
      provider(1, 10).embed(request, new AbortController().signal),
    ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_TIMEOUT" });
  } finally {
    clearTimeout(keepAlive);
  }
});
it("rejects oversized body and excessive input before trusting results", async () => {
  calls
    .mockResolvedValueOnce(Response.json(tags))
    .mockResolvedValueOnce(new Response("x".repeat(10000)));
  await expect(
    provider().embed(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_RESULT_INVALID" });
  calls.mockClear();
  await expect(
    provider().embed(
      { ...request, items: [{ id: "x", text: "ệ".repeat(100) }] },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_INPUT_LIMIT" });
  expect(calls).not.toHaveBeenCalled();
});

it("honors cancellation without retrying or sending private text", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    provider(2).embed(request, controller.signal),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_TIMEOUT" });
  expect(calls).not.toHaveBeenCalled();
});

it("classifies an uninstalled model as retryable unavailability without sending text", async () => {
  calls.mockResolvedValue(Response.json({ models: [] }));
  await expect(
    provider().embed(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_UNAVAILABLE" });
  expect(calls).toHaveBeenCalledTimes(1);
});
