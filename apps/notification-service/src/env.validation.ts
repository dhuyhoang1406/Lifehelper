import Joi from "joi";
const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  SERVICE_NAME: Joi.string().default("notification-service"),
  NOTIFICATION_PORT: Joi.number().port().default(3005),
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
  NOTIFICATION_TITLE_MAX_CHARS: Joi.number()
    .integer()
    .min(1)
    .max(255)
    .default(255),
  NOTIFICATION_BODY_MAX_CHARS: Joi.number()
    .integer()
    .min(1)
    .max(4096)
    .default(4096),
  NOTIFICATION_DATA_MAX_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(8192)
    .default(2048),
  NOTIFICATION_LEASE_MS: Joi.number()
    .integer()
    .min(1)
    .max(300000)
    .default(60000),
  NOTIFICATION_RETRY_MS: Joi.number()
    .integer()
    .min(1)
    .max(3600000)
    .default(30000),
  NOTIFICATION_MAX_ATTEMPTS: Joi.number().integer().min(1).max(100).default(8),
  NOTIFICATION_MAX_TARGETS: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(100),
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
  return value;
}
