import { CloudflareEmbeddingProvider } from "./cloudflare-embedding.provider";
const space = {
  model: "@cf/baai/bge-m3",
  version: "cloudflare-bge-m3-v1",
  dimensions: 1024,
};
const vector = (position: number) =>
  Array.from({ length: 1024 }, (_, i) => (i === position ? 1 : 0));
const request = {
  space,
  items: [
    { id: "one", text: "Xin chào Việt Nam" },
    { id: "two", text: "Điều kiện dự thi" },
  ],
};
let calls: jest.Mock;
function provider(maxAttempts = 1, timeoutMs = 100) {
  return new CloudflareEmbeddingProvider({
    baseUrl: "https://api.cloudflare.com",
    accountId: "a".repeat(32),
    apiToken: "private-token",
    space,
    batchSize: 8,
    maxInputTokens: 8192,
    timeoutMs,
    maxAttempts,
  });
}
function payload(
  data: unknown = [vector(0), vector(1)],
  shape: unknown = [2, 1024],
) {
  return { success: true, errors: [], result: { data, shape } };
}
beforeEach(() => {
  calls = jest.fn();
  jest.spyOn(global, "fetch").mockImplementation(calls);
});
afterEach(() => jest.restoreAllMocks());
it("sends ordered text to the authenticated embedding endpoint without truncation", async () => {
  calls.mockResolvedValue(Response.json(payload()));
  const response = await provider().embed(
    request,
    new AbortController().signal,
  );
  expect(response.items).toEqual([
    { id: "one", vector: vector(0) },
    { id: "two", vector: vector(1) },
  ]);
  const [url, init] = calls.mock.calls[0];
  expect(url.href).toBe(
    `https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/run/@cf/baai/bge-m3`,
  );
  expect(init).toMatchObject({
    redirect: "error",
    headers: { Authorization: "Bearer private-token" },
  });
  expect(JSON.parse(init.body)).toEqual({
    text: request.items.map((item) => item.text),
    truncate_inputs: false,
  });
});
it.each([
  payload([vector(0)], [1, 1024]),
  payload([vector(0), [1]], [2, 1024]),
  payload([Array(1024).fill(0), vector(1)]),
  payload([Array(1024).fill(1e100), vector(1)]),
  payload([Array(1024).fill(null), vector(1)]),
  payload(undefined, [2, 768]),
  {
    success: false,
    errors: [{ message: "private upstream content" }],
    result: {},
  },
  { success: true, result: null },
])(
  "rejects invalid shape, cardinality, finite vector values or envelope",
  async (value) => {
    calls.mockResolvedValue(Response.json(value));
    await expect(
      provider().embed(request, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "DOCUMENT_EMBEDDING_RESULT_INVALID",
      message: "DOCUMENT_EMBEDDING_RESULT_INVALID",
    });
  },
);
it.each([
  [401, "DOCUMENT_EMBEDDING_UNAUTHORIZED", 1],
  [403, "DOCUMENT_EMBEDDING_UNAUTHORIZED", 1],
  [429, "DOCUMENT_EMBEDDING_QUOTA", 2],
  [503, "DOCUMENT_EMBEDDING_UNAVAILABLE", 2],
  [413, "DOCUMENT_EMBEDDING_INPUT_LIMIT", 1],
] as const)(
  "normalizes HTTP %s without leaking bodies or adding a fallback",
  async (status, code, count) => {
    calls.mockImplementation(
      async () => new Response("private-token private document", { status }),
    );
    await expect(
      provider(2).embed(request, new AbortController().signal),
    ).rejects.toMatchObject({ code, message: code });
    expect(calls).toHaveBeenCalledTimes(count);
  },
);
it("rejects an incompatible embedding space and canceled requests before sending text", async () => {
  await expect(
    provider().embed(
      { ...request, space: { ...space, model: "bge-m3:567m" } },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_MODEL_MISMATCH" });
  const controller = new AbortController();
  controller.abort();
  await expect(
    provider().embed(request, controller.signal),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_TIMEOUT" });
  expect(calls).not.toHaveBeenCalled();
});
it("bounds streamed response bytes and stalled bodies", async () => {
  calls.mockResolvedValueOnce(new Response("x".repeat(100000)));
  await expect(
    provider().embed(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: "DOCUMENT_EMBEDDING_RESULT_INVALID" });
  calls.mockImplementationOnce(
    async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener(
              "abort",
              () => controller.error(new Error("private body")),
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
