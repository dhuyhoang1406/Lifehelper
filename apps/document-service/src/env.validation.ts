import Joi from "joi";
const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  SERVICE_NAME: Joi.string().default("document-service"),
  DOCUMENT_RETENTION_BATCH_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100),
  DOCUMENT_TOMBSTONE_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(3650)
    .default(30),
  DOCUMENT_CLEANUP_VERSION_BATCH_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(500),
  DOCUMENT_MAINTENANCE_ENABLED: Joi.when("NODE_ENV", {
    is: "test",
    then: Joi.boolean().default(false),
    otherwise: Joi.boolean().default(true),
  }),
  DOCUMENT_MAINTENANCE_POLL_MS: Joi.number()
    .integer()
    .min(100)
    .max(3600000)
    .default(30000),
  DOCUMENT_MAINTENANCE_BATCH_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(16)
    .default(4),
  DOCUMENT_CLEANUP_LEASE_MS: Joi.number()
    .integer()
    .min(1000)
    .max(900000)
    .default(60000),
  DOCUMENT_CLEANUP_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(120000)
    .default(15000),
  DOCUMENT_CLEANUP_MAX_ATTEMPTS: Joi.number()
    .integer()
    .min(1)
    .max(20)
    .default(8),
  DOCUMENT_CLEANUP_RETRY_BASE_MS: Joi.number()
    .integer()
    .min(100)
    .max(60000)
    .default(1000),
  DOCUMENT_CLEANUP_RETRY_MAX_MS: Joi.number()
    .integer()
    .min(Joi.ref("DOCUMENT_CLEANUP_RETRY_BASE_MS"))
    .max(86400000)
    .default(300000),
  DOCUMENT_CLEANUP_RESWEEP_MS: Joi.number()
    .integer()
    .min(1000)
    .max(86400000)
    .default(3600000),
  DOCUMENT_CLEANUP_GRACE_MS: Joi.number()
    .integer()
    .min(1000)
    .max(86400000)
    .default(900000),
  DOCUMENT_INVENTORY_PAGE_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100),
  DOCUMENT_AUDIT_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(3650)
    .default(30),
  DOCUMENT_GENERATION_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(3650)
    .default(30),
  DOCUMENT_OUTBOX_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .max(3650)
    .default(90),
  DOCUMENT_PORT: Joi.number().port().default(3004),
  DOCUMENT_WORKER_ENABLED: Joi.boolean().default(true),
  DOCUMENT_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(8).default(2),
  DOCUMENT_WORKER_POLL_MS: Joi.number()
    .integer()
    .min(50)
    .max(60000)
    .default(1000),
  DOCUMENT_WORKER_LEASE_MS: Joi.number()
    .integer()
    .min(1000)
    .max(900000)
    .default(60000),
  DOCUMENT_PROCESSING_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(120000)
    .default(30000),
  DOCUMENT_WORKER_SHUTDOWN_MS: Joi.number()
    .integer()
    .min(100)
    .max(30000)
    .default(5000),
  DOCUMENT_PROCESSING_MAX_ATTEMPTS: Joi.number()
    .integer()
    .min(1)
    .max(10)
    .default(3),
  DOCUMENT_PROCESSING_RETRY_BASE_MS: Joi.number()
    .integer()
    .min(10)
    .max(60000)
    .default(500),
  DOCUMENT_PROCESSING_RETRY_MAX_MS: Joi.number()
    .integer()
    .min(Joi.ref("DOCUMENT_PROCESSING_RETRY_BASE_MS"))
    .max(300000)
    .default(30000),
  DOCUMENT_PROCESSING_MAX_CHUNKS: Joi.number()
    .integer()
    .min(1)
    .max(2000)
    .default(1000),
  DOCUMENT_PROCESSING_MAX_TEXT_CHARS: Joi.number()
    .integer()
    .min(1)
    .max(5000000)
    .default(1000000),
  DOCUMENT_PROCESSING_MAX_VECTOR_VALUES: Joi.number()
    .integer()
    .min(1)
    .max(4000000)
    .default(1048576),
  DOCUMENT_EXTRACTION_MAX_PAGES: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100),
  DOCUMENT_EXTRACTION_MAX_EXPANSION_RATIO: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100),
  DOCUMENT_PARSER_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1)
    .max(120000)
    .default(10000),
  DOCUMENT_PARSER_MEMORY_MB: Joi.number()
    .integer()
    .min(32)
    .max(512)
    .default(128),
  DOCUMENT_CHUNK_TARGET_TOKENS: Joi.number()
    .integer()
    .min(4)
    .max(8192)
    .default(512),
  DOCUMENT_CHUNK_OVERLAP_TOKENS: Joi.number()
    .integer()
    .min(0)
    .max(8191)
    .default(64),
  EMBEDDING_PROVIDER: Joi.string()
    .valid("ollama", "cloudflare", "fake")
    .default("ollama"),
  CLOUDFLARE_ACCOUNT_ID: Joi.when("EMBEDDING_PROVIDER", {
    is: "cloudflare",
    then: Joi.string()
      .pattern(/^[a-f0-9]{32}$/)
      .required(),
    otherwise: Joi.any().strip(),
  }),
  CLOUDFLARE_API_TOKEN: Joi.when("EMBEDDING_PROVIDER", {
    is: "cloudflare",
    then: Joi.string()
      .pattern(/^[^\s]+$/)
      .required(),
    otherwise: Joi.any().strip(),
  }),
  EMBEDDING_MODEL: Joi.string().trim().min(1).max(100).default("bge-m3:567m"),
  EMBEDDING_MODEL_VERSION: Joi.string()
    .trim()
    .min(1)
    .max(100)
    .default(
      "7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab",
    ),
  EMBEDDING_BASE_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .default("http://localhost:11434"),
  EMBEDDING_DIMENSIONS: Joi.number().integer().min(1).max(16000).default(1024),
  EMBEDDING_BATCH_SIZE: Joi.number().integer().min(1).max(32).default(8),
  EMBEDDING_MAX_INPUT_TOKENS: Joi.number()
    .integer()
    .min(4)
    .max(8192)
    .default(8192),
  EMBEDDING_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(120000)
    .default(10000),
  EMBEDDING_MAX_ATTEMPTS: Joi.number().integer().min(1).max(3).default(2),
  DOCUMENT_RETRIEVAL_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(120000)
    .default(25000),
  DOCUMENT_RETRIEVAL_MIN_SIMILARITY: Joi.number().min(-1).max(1).default(0.55),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().trim().min(1).required(),
  JWT_AUDIENCE: Joi.string().trim().min(1).required(),
  DOCUMENT_S3_BUCKET: Joi.string()
    .pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .required(),
  DOCUMENT_S3_PUBLIC_ENDPOINT: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .required(),
  DOCUMENT_ALLOWED_EXTENSIONS: Joi.string()
    .pattern(/^(txt|md|pdf)(,(txt|md|pdf))*$/)
    .default("txt,md,pdf"),
  DOCUMENT_MAX_FILE_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  DOCUMENT_MAX_STORAGE_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(100 * 1024 * 1024),
  DOCUMENT_MAX_DOCUMENTS: Joi.number().integer().min(1).max(10000).default(100),
  DOCUMENT_UPLOAD_EXPIRY_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(900)
    .default(300),
  DOCUMENT_DOWNLOAD_EXPIRY_SECONDS: Joi.number()
    .integer()
    .min(1)
    .max(300)
    .default(60),
  DOCUMENT_STORAGE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(60000)
    .default(10000),
  DOCUMENT_STORAGE_MAX_ATTEMPTS: Joi.number()
    .integer()
    .min(1)
    .max(3)
    .default(2),
  DOCUMENT_STORAGE_MAX_CONCURRENT_READS: Joi.number()
    .integer()
    .min(1)
    .max(8)
    .default(2),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgresql", "postgres"] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ["redis", "rediss"] })
    .required(),
  AWS_ENDPOINT_URL: Joi.string().uri().required(),
  AWS_REGION: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_BUCKET: Joi.string().required(),
  SQS_QUEUE_NAME: Joi.string().required(),
  LOG_LEVEL: Joi.string()
    .valid("fatal", "error", "warn", "info", "debug", "trace")
    .default("info"),
  SWAGGER_ENABLED: Joi.boolean().default(false),
  SWAGGER_PATH: Joi.string()
    .trim()
    .pattern(/^[a-zA-Z0-9/_-]+$/)
    .default("docs"),
}).unknown(true);
export function validateEnvironment(config: Record<string, unknown>) {
  const { error, value } = schema.validate(config, { abortEarly: false });
  if (error) throw new Error("Environment validation failed: " + error.message);
  if (
    value.DOCUMENT_WORKER_LEASE_MS <=
    value.DOCUMENT_PROCESSING_TIMEOUT_MS + 10000
  )
    throw new Error(
      "Environment validation failed: worker lease must exceed processing timeout by more than 10000ms",
    );
  if (value.DOCUMENT_CHUNK_OVERLAP_TOKENS >= value.DOCUMENT_CHUNK_TARGET_TOKENS)
    throw new Error(
      "Environment validation failed: overlap must be smaller than chunk target",
    );
  if (value.DOCUMENT_PARSER_TIMEOUT_MS >= value.DOCUMENT_PROCESSING_TIMEOUT_MS)
    throw new Error(
      "Environment validation failed: parser timeout must be smaller than processing timeout",
    );
  if (
    value.EMBEDDING_PROVIDER === "ollama" &&
    !/^[a-f0-9]{64}$/.test(value.EMBEDDING_MODEL_VERSION)
  )
    throw new Error(
      "Environment validation failed: Ollama model version must be the full manifest digest",
    );
  if (
    value.EMBEDDING_PROVIDER === "cloudflare" &&
    (value.EMBEDDING_MODEL !== "@cf/baai/bge-m3" ||
      value.EMBEDDING_DIMENSIONS !== 1024 ||
      !/^cloudflare-bge-m3-[a-z0-9][a-z0-9._-]*$/.test(
        value.EMBEDDING_MODEL_VERSION,
      ) ||
      value.EMBEDDING_BASE_URL !== "https://api.cloudflare.com")
  )
    throw new Error(
      "Environment validation failed: Cloudflare requires its HTTPS API origin, BGE-M3 1024 dimensions and a separate cloudflare-bge-m3 revision",
    );
  const embeddingUrl = new URL(value.EMBEDDING_BASE_URL);
  if (
    embeddingUrl.username ||
    embeddingUrl.password ||
    embeddingUrl.pathname !== "/" ||
    embeddingUrl.search ||
    embeddingUrl.hash
  )
    throw new Error(
      "Environment validation failed: embedding base URL must be an origin without credentials",
    );
  if (value.EMBEDDING_PROVIDER === "fake" && value.NODE_ENV !== "test")
    throw new Error(
      "Environment validation failed: fake embeddings are test-only",
    );
  if (value.EMBEDDING_TIMEOUT_MS >= value.DOCUMENT_PROCESSING_TIMEOUT_MS)
    throw new Error(
      "Environment validation failed: embedding timeout must be smaller than processing timeout",
    );
  if (value.DOCUMENT_CHUNK_TARGET_TOKENS > value.EMBEDDING_MAX_INPUT_TOKENS)
    throw new Error(
      "Environment validation failed: chunk target exceeds embedding input budget",
    );
  if (
    value.EMBEDDING_DIMENSIONS * value.DOCUMENT_PROCESSING_MAX_CHUNKS >
    value.DOCUMENT_PROCESSING_MAX_VECTOR_VALUES
  )
    throw new Error(
      "Environment validation failed: vector budget must fit all configured chunks",
    );
  if (
    value.DOCUMENT_CLEANUP_LEASE_MS <=
    value.DOCUMENT_CLEANUP_TIMEOUT_MS + 10000
  )
    throw new Error(
      "Environment validation failed: cleanup lease must exceed timeout by more than 10000ms",
    );
  if (
    value.DOCUMENT_CLEANUP_GRACE_MS <
    value.DOCUMENT_UPLOAD_EXPIRY_SECONDS * 1000
  )
    throw new Error(
      "Environment validation failed: orphan grace must cover the maximum upload authorization duration",
    );
  return value;
}
