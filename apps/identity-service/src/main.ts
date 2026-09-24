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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  configureSwagger(app, {
    title: "Lifehelper Identity API",
    description: "Authentication, user profile, and session management APIs.",
  });
  await app.listen(
    app.get(ConfigService).getOrThrow<number>("IDENTITY_PORT"),
    "0.0.0.0",
  );
}
void bootstrap();
