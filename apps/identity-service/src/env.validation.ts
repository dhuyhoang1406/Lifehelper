import Joi from "joi";
const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  SERVICE_NAME: Joi.string().default("identity-service"),
  IDENTITY_PORT: Joi.number().port().default(3001),
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
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN_SECONDS: Joi.number().integer().min(60).default(900),
  JWT_ISSUER: Joi.string().min(1).required(),
  JWT_AUDIENCE: Joi.string().min(1).required(),
  REFRESH_TOKEN_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .default(2_592_000),
  GOOGLE_CLIENT_ID: Joi.string().min(1).required(),
  AUTH_RATE_LIMIT_TTL_MS: Joi.number().integer().min(1_000).default(60_000),
  AUTH_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(10),
}).unknown(true);
export function validateEnvironment(config: Record<string, unknown>) {
  const { error, value } = schema.validate(config, { abortEarly: false });
  if (error) throw new Error("Environment validation failed: " + error.message);
  return value;
}
