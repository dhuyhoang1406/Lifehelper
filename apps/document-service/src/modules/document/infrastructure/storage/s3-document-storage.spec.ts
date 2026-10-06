import { createServer, type Server } from "node:http";
import { S3DocumentStorage } from "./s3-document-storage";
let server: Server;
let storage: S3DocumentStorage;
afterEach(async () => {
  storage?.onModuleDestroy();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it.each([1, 2])(
  "bounds %i concurrent reads and normalizes stalled body timeouts",
  async (maxConcurrentReads) => {
    server = createServer((req, res) => {
      res.setHeader("x-amz-version-id", "version-1");
      res.setHeader("Content-Length", "6");
      res.setHeader("Content-Type", "text/plain");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.flushHeaders();
      res.write("he");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test listener");
    const endpoint = `http://127.0.0.1:${address.port}`;
    storage = new S3DocumentStorage({
      endpoint,
      publicEndpoint: endpoint,
      region: "ap-southeast-1",
      accessKeyId: "test",
      secretAccessKey: "test",
      timeoutMs: 100,
      maxAttempts: 1,
      maxConcurrentReads,
    });
    const reads = Array.from({ length: maxConcurrentReads }, () =>
      storage.readForVerification({ bucket: "private-test", key: "text" }, 64),
    );
    await expect(
      storage.readForVerification({ bucket: "private-test", key: "text" }, 64),
    ).rejects.toMatchObject({ code: "DOCUMENT_STORAGE_BUSY", statusCode: 429 });
    await Promise.all(
      reads.map(async (read) => {
        await expect(read).rejects.toMatchObject({
          code: "DOCUMENT_STORAGE_TIMEOUT",
          statusCode: 504,
        });
      }),
    );
    // Timeout releases capacity for a later request.
    await expect(
      storage.readForVerification({ bucket: "private-test", key: "text" }, 64),
    ).rejects.toMatchObject({
      code: "DOCUMENT_STORAGE_TIMEOUT",
      statusCode: 504,
    });
  },
);
