process.env.NODE_ENV = "test";
process.env.SERVICE_NAME = "document-service";
process.env.DOCUMENT_PORT = "3004";
process.env.DATABASE_URL =
  "postgresql://lifehelper:lifehelper@localhost:5432/lifehelper_document?schema=public";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.AWS_ENDPOINT_URL = "http://localhost:4566";
process.env.AWS_REGION = "ap-southeast-1";
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
process.env.S3_BUCKET = "lifehelper-local";
process.env.SQS_QUEUE_NAME = "lifehelper-events";

process.env.JWT_ACCESS_SECRET = "document-test-secret-at-least-32-characters";
process.env.JWT_ISSUER = "lifehelper-identity";
process.env.JWT_AUDIENCE = "lifehelper-mobile";
process.env.DOCUMENT_S3_BUCKET = "lifehelper-documents-test";
process.env.DOCUMENT_S3_PUBLIC_ENDPOINT = "http://localhost:4566";
