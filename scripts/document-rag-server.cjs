// Verification-only bootstrap: real providers, isolated DBs, no additional API routes.
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");
const service = process.argv[2];
if (!["ai", "document", "pdf"].includes(service))
  throw new Error("Unknown service");
const directory = resolve(
  __dirname,
  "../apps/" + (service === "pdf" ? "document" : service) + "-service",
);
const local = createRequire(resolve(directory, "package.json"));
if (service === "pdf") {
  const { textPdf } = local(resolve(directory, "dist/testing/pdf-fixtures"));
  process.stdout.write(
    Buffer.from(textPdf(JSON.parse(readFileSync(0, "utf8")))).toString(
      "base64",
    ),
  );
} else {
  main().catch((error) => {
    let message = error.message;
    for (const [key, value] of Object.entries(process.env)) {
      if (/SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(key) && value)
        message = message.split(value).join("[redacted]");
    }
    console.log(JSON.stringify({ type: "startup_error", message }));
    process.exitCode = 1;
  });
}
async function main() {
  const database = new URL(process.env.DATABASE_URL);
  if (
    process.env.NODE_ENV !== "test" ||
    !new RegExp("^rag_[a-f0-9]{12}_" + service + "_test$").test(
      database.pathname.slice(1),
    )
  )
    throw new Error("Owned verification database required");
  local("reflect-metadata");
  const { NestFactory } = local("@nestjs/core");
  const { ValidationPipe } = local("@nestjs/common");
  const { AppModule } = local(resolve(directory, "dist/app.module"));
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  function measure(tokenPath, tokenName, method, stage) {
    const token = local(resolve(directory, "dist/" + tokenPath))[tokenName];
    const target = app.get(token);
    const original = target[method].bind(target);
    target[method] = async (...args) => {
      const start = performance.now();
      let success = false;
      try {
        const result = await original(...args);
        success = true;
        return result;
      } finally {
        console.log(
          JSON.stringify({
            type: "metric",
            stage,
            success,
            ms: performance.now() - start,
          }),
        );
      }
    };
  }
  if (service === "document") {
    measure(
      "modules/document/application/ports/embedding-provider.port",
      "EMBEDDING_PROVIDER",
      "embed",
      "embedding_call",
    );
    measure(
      "modules/document/application/ports/document-extraction.port",
      "DOCUMENT_TEXT_EXTRACTOR",
      "extract",
      "extraction_call",
    );
  } else {
    measure(
      "modules/ai/application/ports/ai-provider.port",
      "AI_PROVIDER_INSTANCE",
      "generate",
      "generation_call",
    );
  }
  await app.listen(0, "127.0.0.1");
  console.log(
    JSON.stringify({ type: "ready", port: app.getHttpServer().address().port }),
  );
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await app.close();
  }
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());
}
