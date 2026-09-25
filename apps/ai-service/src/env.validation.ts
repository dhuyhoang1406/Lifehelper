import Joi from "joi";
const schema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  SERVICE_NAME: Joi.string().default("ai-service"),
  AI_PORT: Joi.number().port().default(3003),
  AI_PROVIDER: Joi.string().valid("ollama", "cloudflare").required(),
  AI_MODEL: Joi.string().trim().min(1).max(200).required(),
  AI_BASE_URL: Joi.when("AI_PROVIDER", {
    is: "cloudflare",
    then: Joi.string().uri({ scheme: ["https"] }).required(),
    otherwise: Joi.string().uri({ scheme: ["http", "https"] }).required(),
  }),
  AI_TIMEOUT_MS: Joi.number().integer().min(100).max(300_000).required(),
  AI_MAX_OUTPUT_TOKENS: Joi.number()
    .integer()
    .positive()
    .max(65_536)
    .required(),
  AI_MAX_CONTEXT_MESSAGES: Joi.number()
    .integer()
    .positive()
    .max(500)
    .required(),
  AI_RETRY_MAX_ATTEMPTS: Joi.number().integer().min(1).max(5).required(),
  AI_RETRY_BASE_DELAY_MS: Joi.number()
    .integer()
    .positive()
    .max(10_000)
    .required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().trim().min(1).required(),
  JWT_AUDIENCE: Joi.string().trim().min(1).required(),
  CLOUDFLARE_ACCOUNT_ID: Joi.when("AI_PROVIDER", {
    is: "cloudflare",
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.any().strip(),
  }),
  CLOUDFLARE_API_TOKEN: Joi.when("AI_PROVIDER", {
    is: "cloudflare",
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.any().strip(),
  }),
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
  return value;
}
