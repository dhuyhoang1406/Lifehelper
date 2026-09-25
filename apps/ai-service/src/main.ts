import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Logger } from "nestjs-pino";
import { configureSwagger } from "@lifehelper/swagger";
import { AppModule } from "./app.module";
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  configureSwagger(app, {
    title: "Lifehelper AI API",
    description: "AI assistant and automation APIs.",
  });
  await app.listen(
    app.get(ConfigService).getOrThrow<number>("AI_PORT"),
    "0.0.0.0",
  );
}
void bootstrap();
