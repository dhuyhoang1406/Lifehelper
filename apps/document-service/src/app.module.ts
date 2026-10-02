import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService, ConfigModule } from "@nestjs/config";
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
import { DocumentController } from "./presentation/document.controller";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { DOCUMENT_STORAGE } from "./application/ports/document-storage.port";
import type { DocumentStorage } from "./application/ports/document-storage.port";
import { DOCUMENT_UPLOAD_REPOSITORY } from "./application/ports/document-upload.repository";
import type { DocumentUploadRepository } from "./application/ports/document-upload.repository";
import type { DocumentRepository } from "./application/repositories/document.repositories";
import { PrismaDocumentUploadRepository } from "./persistence/document-upload.repository";
import { S3DocumentStorage } from "./infrastructure/storage/s3-document-storage";
import { DocumentUploadUseCases } from "./application/services/document-upload.use-cases";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    StructuredLoggerModule,
    JwtModule.register({}),
  ],
  controllers: [HealthController, DocumentController],
  providers: [
    PrismaService,
    JwtAuthGuard,
    {
      provide: DOCUMENT_UPLOAD_REPOSITORY,
      useFactory: (db: PrismaService) => new PrismaDocumentUploadRepository(db),
      inject: [PrismaService],
    },
    {
      provide: DOCUMENT_STORAGE,
      useFactory: (c: ConfigService) =>
        new S3DocumentStorage({
          endpoint: c.getOrThrow("AWS_ENDPOINT_URL"),
          publicEndpoint: c.getOrThrow("DOCUMENT_S3_PUBLIC_ENDPOINT"),
          region: c.getOrThrow("AWS_REGION"),
          accessKeyId: c.getOrThrow("AWS_ACCESS_KEY_ID"),
          secretAccessKey: c.getOrThrow("AWS_SECRET_ACCESS_KEY"),
          timeoutMs: c.getOrThrow("DOCUMENT_STORAGE_TIMEOUT_MS"),
          maxAttempts: c.getOrThrow("DOCUMENT_STORAGE_MAX_ATTEMPTS"),
          maxConcurrentReads: c.getOrThrow(
            "DOCUMENT_STORAGE_MAX_CONCURRENT_READS",
          ),
        }),
      inject: [ConfigService],
    },
    {
      provide: DocumentUploadUseCases,
      useFactory: (
        documents: DocumentRepository,
        uploads: DocumentUploadRepository,
        storage: DocumentStorage,
        c: ConfigService,
      ) =>
        new DocumentUploadUseCases(documents, uploads, storage, {
          allowedExtensions: c
            .getOrThrow<string>("DOCUMENT_ALLOWED_EXTENSIONS")
            .split(","),
          maxFileBytes: c.getOrThrow("DOCUMENT_MAX_FILE_BYTES"),
          maxDocuments: c.getOrThrow("DOCUMENT_MAX_DOCUMENTS"),
          maxStorageBytes: c.getOrThrow("DOCUMENT_MAX_STORAGE_BYTES"),
          uploadExpirySeconds: c.getOrThrow("DOCUMENT_UPLOAD_EXPIRY_SECONDS"),
          downloadExpirySeconds: c.getOrThrow(
            "DOCUMENT_DOWNLOAD_EXPIRY_SECONDS",
          ),
          bucket: c.getOrThrow("DOCUMENT_S3_BUCKET"),
        }),
      inject: [
        DOCUMENT_REPOSITORY,
        DOCUMENT_UPLOAD_REPOSITORY,
        DOCUMENT_STORAGE,
        ConfigService,
      ],
    },
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
