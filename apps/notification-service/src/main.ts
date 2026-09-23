import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "nestjs-pino";
import { configureSwagger } from "@lifehelper/swagger";
import { AppModule } from "./app.module";
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  configureSwagger(app, {
    title: "Lifehelper Notification API",
    description: "Notification and delivery APIs.",
  });
  await app.listen(
    app.get(ConfigService).getOrThrow<number>("NOTIFICATION_PORT"),
    "0.0.0.0",
  );
}
void bootstrap();
