import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StructuredLoggerModule } from "@lifehelper/logger";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { validateEnvironment } from "./env.validation";
import {
  DOCUMENT_REPOSITORY,
  DOCUMENT_CHUNK_REPOSITORY,
  DOCUMENT_GENERATION_REPOSITORY,
  DOCUMENT_PROCESSING_JOB_REPOSITORY,
  DOCUMENT_EMBEDDING_REPOSITORY,
} from "./application/repositories/document.repositories";
import {
  PrismaDocumentRepository,
  PrismaDocumentChunkRepository,
  PrismaDocumentGenerationRepository,
  PrismaDocumentProcessingJobRepository,
  PrismaDocumentEmbeddingRepository,
} from "./persistence/document.persistence";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    {
      provide: DOCUMENT_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaDocumentRepository(db),
      inject: [PrismaService],
    },
    {
      provide: DOCUMENT_CHUNK_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaDocumentChunkRepository(db),
      inject: [PrismaService],
    },
    {
      provide: DOCUMENT_GENERATION_REPOSITORY,
      useFactory: (db: PrismaService) =>
        new PrismaDocumentGenerationRepository(db),
      inject: [PrismaService],
    },
    {
      provide: DOCUMENT_PROCESSING_JOB_REPOSITORY,
      useFactory: (db: PrismaService) =>
        new PrismaDocumentProcessingJobRepository(db),
      inject: [PrismaService],
    },
    {
      provide: DOCUMENT_EMBEDDING_REPOSITORY,
      useFactory: (db: PrismaService) =>
        new PrismaDocumentEmbeddingRepository(db),
      inject: [PrismaService],
    },
  ],
})
export class AppModule {}
