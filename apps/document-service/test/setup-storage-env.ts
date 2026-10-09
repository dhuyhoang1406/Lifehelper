if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL to a migrated *_test or *_ci database");
process.env.NODE_ENV = "test";
process.env.DOCUMENT_WORKER_ENABLED = "false";
process.env.SERVICE_NAME = "document-service";
process.env.DOCUMENT_PORT = "3004";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.AWS_ENDPOINT_URL =
  process.env.DOCUMENT_STORAGE_TEST_ENDPOINT ?? "http://localhost:4566";
process.env.DOCUMENT_S3_PUBLIC_ENDPOINT = process.env.AWS_ENDPOINT_URL;
process.env.AWS_REGION = "ap-southeast-1";
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
process.env.S3_BUCKET = "unused-test-baseline";
process.env.SQS_QUEUE_NAME = "unused-test-queue";
process.env.DOCUMENT_S3_BUCKET = `lifehelper-document-storage-test-${process.pid}`;
process.env.JWT_ACCESS_SECRET =
  "document-storage-test-secret-at-least-32-chars";
process.env.JWT_ISSUER = "lifehelper-identity";
process.env.JWT_AUDIENCE = "lifehelper-mobile";
process.env.DOCUMENT_MAX_DOCUMENTS = "2";
process.env.DOCUMENT_MAX_STORAGE_BYTES = "128";
process.env.DOCUMENT_MAX_FILE_BYTES = "64";
process.env.DOCUMENT_UPLOAD_EXPIRY_SECONDS = "60";
process.env.LOG_LEVEL = "fatal";

process.env.EMBEDDING_PROVIDER = "fake";
process.env.EMBEDDING_MODEL = "fixture-model";
process.env.EMBEDDING_MODEL_VERSION = "fake-v1";
