import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger)); app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).getOrThrow<number>('AI_PORT'), '0.0.0.0');
}
void bootstrap();
