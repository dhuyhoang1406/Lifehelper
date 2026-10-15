import { DocumentHttpClient } from "./document-http.client";
const id = "00000000-0000-4000-8000-000000000001",
  chunkId = "00000000-0000-4000-8000-000000000002";
const ctx = {
  userId: "owner",
  accessToken: "forwarded-access-token",
  correlationId: "trace-123",
};
const passage = {
  documentId: id,
  chunkId,
  generation: 1,
  chunkIndex: 0,
  filename: "notes.txt",
  locator: { kind: "LINE", start: 1, end: 2 },
  content: "Nội dung",
};
describe("Document HTTP trust and contract", () => {
  let transport: jest.MockedFunction<typeof fetch>, client: DocumentHttpClient;
  beforeEach(() => {
    transport = jest.fn();
    client = new DocumentHttpClient(
      "http://document-service:3004",
      100,
      transport,
    );
  });
  it("forwards Identity token/correlation and strips unknown response properties", async () => {
    transport.mockResolvedValue(
      Response.json({
        items: [
          {
            ...passage,
            excerpt: "Nội dung",
            similarity: 0.8,
            s3Key: "must-not-leak",
          },
        ],
      }),
    );
    const result = await client.search(ctx, {
      query: "nội dung",
      topK: 3,
      documentIds: [id],
    });
    expect(result[0]).not.toHaveProperty("s3Key");
    expect(transport.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      headers: {
        authorization: "Bearer forwarded-access-token",
        "x-correlation-id": "trace-123",
      },
    });
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual({
      query: "nội dung",
      topK: 3,
      documentIds: [id],
    });
  });
  it.each([
    [404, "AI_DOCUMENT_NOT_FOUND", 404],
    [429, "AI_DOCUMENT_QUOTA", 429],
    [504, "AI_DOCUMENT_TIMEOUT", 504],
    [503, "AI_DOCUMENT_UNAVAILABLE", 503],
    [401, "AI_DOCUMENT_UNAVAILABLE", 503],
  ])(
    "normalizes %i without returning upstream content",
    async (status, code, statusCode) => {
      transport.mockResolvedValue(
        new Response("private upstream secret", { status }),
      );
      await expect(client.chunk(ctx, id, chunkId, 1)).rejects.toMatchObject({
        code,
        statusCode,
        message: "Document request failed",
      });
    },
  );
  it("rejects foreign IDs and malformed locators", async () => {
    transport.mockResolvedValue(
      Response.json({
        items: [
          { ...passage, documentId: chunkId, excerpt: "x", similarity: 0.9 },
        ],
      }),
    );
    await expect(
      client.search(ctx, { query: "x", topK: 1, documentIds: [id] }),
    ).rejects.toMatchObject({ code: "AI_DOCUMENT_INVALID_RESPONSE" });
    transport.mockResolvedValue(
      Response.json({
        ...passage,
        locator: { kind: "PAGE", start: 2, end: 1 },
      }),
    );
    await expect(client.chunk(ctx, id, chunkId, 1)).rejects.toMatchObject({
      code: "AI_DOCUMENT_INVALID_RESPONSE",
    });
  });
  it("rejects stale generation, unordered pages and nonadvancing cursors", async () => {
    transport.mockResolvedValue(Response.json({ ...passage, generation: 2 }));
    await expect(client.chunk(ctx, id, chunkId, 1)).rejects.toMatchObject({
      statusCode: 502,
    });
    transport.mockResolvedValue(
      Response.json({ items: [passage], next: { generation: 1, after: 0 } }),
    );
    await expect(
      client.chunks(ctx, id, { limit: 10, generation: 1, after: 0 }),
    ).rejects.toMatchObject({ statusCode: 502 });
    transport.mockResolvedValue(
      Response.json({ items: [passage], next: { generation: 1, after: 1 } }),
    );
    await expect(client.chunks(ctx, id, { limit: 10 })).rejects.toMatchObject({
      statusCode: 502,
    });
  });
  it("bounds response bytes and rejects invalid JSON", async () => {
    transport.mockResolvedValue(new Response("a".repeat(300001)));
    await expect(client.chunk(ctx, id, chunkId, 1)).rejects.toMatchObject({
      statusCode: 502,
    });
    transport.mockResolvedValue(new Response("not JSON"));
    await expect(client.chunk(ctx, id, chunkId, 1)).rejects.toMatchObject({
      statusCode: 502,
    });
  });
  it("maps aborts to timeout", async () => {
    transport.mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) =>
          options!.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          ),
        ),
    );
    await expect(client.chunk(ctx, id, chunkId, 1)).rejects.toMatchObject({
      code: "AI_DOCUMENT_TIMEOUT",
      statusCode: 504,
    });
  });
  it.each([
    "http://user:secret@localhost:3004",
    "http://localhost:3004/path",
    "http://localhost:3004/?secret=x",
  ])("rejects unsafe configured origin %s", (url) => {
    expect(() => new DocumentHttpClient(url, 100, transport)).toThrow();
  });
});
