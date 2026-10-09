import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from "./application/ports/embedding-provider.port";
import { OllamaEmbeddingProvider } from "./infrastructure/embedding/ollama-embedding.provider";
import { FakeEmbeddingProvider } from "../../testing/fake-embedding.provider";
import { DocumentIndexingStages } from "./application/services/document-indexing.stages";
import { PrismaModule } from "../../prisma.module";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma.service";
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
} from "../../persistence/document.persistence";
import { DocumentController } from "./presentation/document.controller";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { DOCUMENT_STORAGE } from "./application/ports/document-storage.port";
import type { DocumentStorage } from "./application/ports/document-storage.port";
import { DOCUMENT_UPLOAD_REPOSITORY } from "./application/ports/document-upload.repository";
import type { DocumentUploadRepository } from "./application/ports/document-upload.repository";
import type { DocumentRepository } from "./application/repositories/document.repositories";
import { PrismaDocumentUploadRepository } from "../../persistence/document-upload.repository";
import { S3DocumentStorage } from "./infrastructure/storage/s3-document-storage";
import { DocumentUploadUseCases } from "./application/use-cases/document-upload.use-cases";
import { PinoLogger } from "nestjs-pino";
import {
  DOCUMENT_PROCESSING_REPOSITORY,
  DOCUMENT_PROCESSING_STAGES,
  type DocumentProcessingRepository,
  type DocumentProcessingStages,
} from "./application/ports/document-processing.port";
import { PrismaDocumentProcessingRepository } from "../../persistence/document-processing.repository";
import { DocumentProcessingRetryUseCase } from "./application/use-cases/document-processing-retry.use-case";
import { DocumentJobProcessor } from "./application/services/document-job-processor";
import { DocumentProcessingWorker } from "./infrastructure/processing/document-processing-worker";
import { BoundedTextExtractor } from "./infrastructure/extraction/bounded-text-extractor";
import {
  DOCUMENT_TEXT_EXTRACTOR,
  type DocumentTextExtractor,
} from "./application/ports/document-extraction.port";
import { DocumentExtractionStages } from "./application/services/document-extraction.stages";
@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [DocumentController],
  providers: [
    {
      provide: DOCUMENT_TEXT_EXTRACTOR,
      useFactory: (c: ConfigService) =>
        new BoundedTextExtractor({
          maxFileBytes: c.getOrThrow("DOCUMENT_MAX_FILE_BYTES"),
          maxPages: c.getOrThrow("DOCUMENT_EXTRACTION_MAX_PAGES"),
          maxTextChars: c.getOrThrow("DOCUMENT_PROCESSING_MAX_TEXT_CHARS"),
          maxExpansionRatio: c.getOrThrow(
            "DOCUMENT_EXTRACTION_MAX_EXPANSION_RATIO",
          ),
          timeoutMs: c.getOrThrow("DOCUMENT_PARSER_TIMEOUT_MS"),
          memoryMb: c.getOrThrow("DOCUMENT_PARSER_MEMORY_MB"),
        }),
      inject: [ConfigService],
    },
    JwtAuthGuard,
    {
      provide: DOCUMENT_PROCESSING_REPOSITORY,
      useFactory: (db: PrismaService, c: ConfigService) =>
        new PrismaDocumentProcessingRepository(db, {
          embeddingSpace: {
            model: c.getOrThrow("EMBEDDING_MODEL"),
            version: c.getOrThrow("EMBEDDING_MODEL_VERSION"),
            dimensions: c.getOrThrow("EMBEDDING_DIMENSIONS"),
          },
          leaseMs: c.getOrThrow("DOCUMENT_WORKER_LEASE_MS"),
          maxAttempts: c.getOrThrow("DOCUMENT_PROCESSING_MAX_ATTEMPTS"),
          baseDelayMs: c.getOrThrow("DOCUMENT_PROCESSING_RETRY_BASE_MS"),
          maxDelayMs: c.getOrThrow("DOCUMENT_PROCESSING_RETRY_MAX_MS"),
          maxChunks: c.getOrThrow("DOCUMENT_PROCESSING_MAX_CHUNKS"),
          maxTextChars: c.getOrThrow("DOCUMENT_PROCESSING_MAX_TEXT_CHARS"),
          maxVectorValues: c.getOrThrow(
            "DOCUMENT_PROCESSING_MAX_VECTOR_VALUES",
          ),
        }),
      inject: [PrismaService, ConfigService],
    },
    {
      provide: DOCUMENT_PROCESSING_STAGES,
      useFactory: (
        extractor: DocumentTextExtractor,
        provider: EmbeddingProvider,
        c: ConfigService,
      ) =>
        new DocumentIndexingStages(
          new DocumentExtractionStages(extractor, {
            targetTokens: c.getOrThrow("DOCUMENT_CHUNK_TARGET_TOKENS"),
            overlapTokens: c.getOrThrow("DOCUMENT_CHUNK_OVERLAP_TOKENS"),
            maxChunks: c.getOrThrow("DOCUMENT_PROCESSING_MAX_CHUNKS"),
          }),
          provider,
          {
            space: {
              model: c.getOrThrow("EMBEDDING_MODEL"),
              version: c.getOrThrow("EMBEDDING_MODEL_VERSION"),
              dimensions: c.getOrThrow("EMBEDDING_DIMENSIONS"),
            },
            batchSize: c.getOrThrow("EMBEDDING_BATCH_SIZE"),
            maxInputTokens: c.getOrThrow("EMBEDDING_MAX_INPUT_TOKENS"),
          },
        ),
      inject: [DOCUMENT_TEXT_EXTRACTOR, EMBEDDING_PROVIDER, ConfigService],
    },
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (c: ConfigService) =>
        c.getOrThrow("EMBEDDING_PROVIDER") === "fake"
          ? new FakeEmbeddingProvider()
          : new OllamaEmbeddingProvider({
              baseUrl: c.getOrThrow("EMBEDDING_BASE_URL"),
              space: {
                model: c.getOrThrow("EMBEDDING_MODEL"),
                version: c.getOrThrow("EMBEDDING_MODEL_VERSION"),
                dimensions: c.getOrThrow("EMBEDDING_DIMENSIONS"),
              },
              batchSize: c.getOrThrow("EMBEDDING_BATCH_SIZE"),
              maxInputTokens: c.getOrThrow("EMBEDDING_MAX_INPUT_TOKENS"),
              timeoutMs: c.getOrThrow("EMBEDDING_TIMEOUT_MS"),
              maxAttempts: c.getOrThrow("EMBEDDING_MAX_ATTEMPTS"),
            }),
      inject: [ConfigService],
    },
    {
      provide: DocumentProcessingRetryUseCase,
      useFactory: (jobs: DocumentProcessingRepository) =>
        new DocumentProcessingRetryUseCase(jobs),
      inject: [DOCUMENT_PROCESSING_REPOSITORY],
    },
    {
      provide: DocumentJobProcessor,
      useFactory: (
        jobs: DocumentProcessingRepository,
        storage: DocumentStorage,
        stages: DocumentProcessingStages,
        c: ConfigService,
      ) =>
        new DocumentJobProcessor(
          jobs,
          storage,
          stages,
          c.getOrThrow("DOCUMENT_MAX_FILE_BYTES"),
          c.getOrThrow("DOCUMENT_PROCESSING_TIMEOUT_MS"),
        ),
      inject: [
        DOCUMENT_PROCESSING_REPOSITORY,
        DOCUMENT_STORAGE,
        DOCUMENT_PROCESSING_STAGES,
        ConfigService,
      ],
    },
    {
      provide: DocumentProcessingWorker,
      useFactory: (
        jobs: DocumentProcessingRepository,
        processor: DocumentJobProcessor,
        c: ConfigService,
        logger: PinoLogger,
      ) =>
        new DocumentProcessingWorker(
          jobs,
          processor,
          {
            enabled: c.getOrThrow("DOCUMENT_WORKER_ENABLED"),
            concurrency: c.getOrThrow("DOCUMENT_WORKER_CONCURRENCY"),
            pollMs: c.getOrThrow("DOCUMENT_WORKER_POLL_MS"),
            shutdownMs: c.getOrThrow("DOCUMENT_WORKER_SHUTDOWN_MS"),
          },
          logger,
        ),
      inject: [
        DOCUMENT_PROCESSING_REPOSITORY,
        DocumentJobProcessor,
        ConfigService,
        PinoLogger,
      ],
    },
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
export class DocumentModule {}
