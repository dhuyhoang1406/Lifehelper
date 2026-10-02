import { validateEnvironment } from "./env.validation";
const config = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/document_test",
  REDIS_URL: "redis://localhost:6379",
  AWS_ENDPOINT_URL: "http://localhost:4566",
  AWS_REGION: "ap-southeast-1",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  S3_BUCKET: "baseline",
  SQS_QUEUE_NAME: "queue",
  JWT_ACCESS_SECRET: "document-test-secret-at-least-32-chars",
  JWT_ISSUER: "identity",
  JWT_AUDIENCE: "mobile",
  DOCUMENT_S3_BUCKET: "private-documents",
  DOCUMENT_S3_PUBLIC_ENDPOINT: "http://localhost:4566",
};
it("validates defaults for bounded private upload configuration", () => {
  expect(validateEnvironment(config)).toMatchObject({
    DOCUMENT_MAX_FILE_BYTES: 10485760,
    DOCUMENT_DOWNLOAD_EXPIRY_SECONDS: 60,
  });
});
it.each([
  { DOCUMENT_MAX_FILE_BYTES: -1 },
  { DOCUMENT_UPLOAD_EXPIRY_SECONDS: 901 },
  { DOCUMENT_DOWNLOAD_EXPIRY_SECONDS: 301 },
  { DOCUMENT_STORAGE_MAX_ATTEMPTS: 4 },
  { DOCUMENT_STORAGE_MAX_CONCURRENT_READS: 9 },
  { DOCUMENT_WORKER_CONCURRENCY: 0 },
  { DOCUMENT_WORKER_CONCURRENCY: 9 },
  { DOCUMENT_PROCESSING_MAX_ATTEMPTS: 11 },
  {
    DOCUMENT_PROCESSING_RETRY_BASE_MS: 1000,
    DOCUMENT_PROCESSING_RETRY_MAX_MS: 100,
  },
  { DOCUMENT_WORKER_LEASE_MS: 30000 },
  { DOCUMENT_ALLOWED_EXTENSIONS: "exe" },
  { JWT_ACCESS_SECRET: "short" },
  { DOCUMENT_S3_PUBLIC_ENDPOINT: "file:///tmp/x" },
])("rejects invalid upload/auth limits %p", (invalid) => {
  expect(() => validateEnvironment({ ...config, ...invalid })).toThrow(
    "Environment validation failed",
  );
});
