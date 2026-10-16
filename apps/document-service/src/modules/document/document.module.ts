import { CloudflareEmbeddingProvider } from "./infrastructure/embedding/cloudflare-embedding.provider";
import { DocumentReprocessUseCase } from "./application/use-cases/document-reprocess.use-case";
import { DocumentLifecycleMaintenance } from "./application/services/document-lifecycle-maintenance";
import { DocumentMaintenanceWorker } from "./infrastructure/processing/document-maintenance-worker";
import { PrismaDocumentLifecycleRepository } from "../../persistence/document-lifecycle.repository";
import {
  DOCUMENT_LIFECYCLE_REPOSITORY,
  DOCUMENT_MAINTENANCE_STORAGE,
  type DocumentLifecycleRepository,
  type DocumentMaintenanceStorage,
} from "./application/ports/document-lifecycle.port";
import { DocumentRetrievalController } from "./presentation/document-retrieval.controller";
import { DocumentRetrievalUseCases } from "./application/use-cases/document-retrieval.use-cases";
import { PrismaDocumentVectorIndex } from "../../persistence/document-vector-index";
import { PrismaDocumentRetrievalRepository } from "../../persistence/document-retrieval.repository";
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
  controllers: [DocumentController, DocumentRetrievalController],
  providers: [
    {
      provide: DOCUMENT_LIFECYCLE_REPOSITORY,
      useFactory: (db: PrismaService, c: ConfigService) =>
        new PrismaDocumentLifecycleRepository(db, {
          leaseMs: c.getOrThrow("DOCUMENT_CLEANUP_LEASE_MS"),
          maxAttempts: c.getOrThrow("DOCUMENT_CLEANUP_MAX_ATTEMPTS"),
          retryBaseMs: c.getOrThrow("DOCUMENT_CLEANUP_RETRY_BASE_MS"),
          retryMaxMs: c.getOrThrow("DOCUMENT_CLEANUP_RETRY_MAX_MS"),
          resweepMs: c.getOrThrow("DOCUMENT_CLEANUP_RESWEEP_MS"),
          graceMs: c.getOrThrow("DOCUMENT_CLEANUP_GRACE_MS"),
          auditDays: c.getOrThrow("DOCUMENT_AUDIT_RETENTION_DAYS"),
          generationDays: c.getOrThrow("DOCUMENT_GENERATION_RETENTION_DAYS"),
          outboxDays: c.getOrThrow("DOCUMENT_OUTBOX_RETENTION_DAYS"),
          retentionBatchSize: c.getOrThrow("DOCUMENT_RETENTION_BATCH_SIZE"),
          tombstoneDays: c.getOrThrow("DOCUMENT_TOMBSTONE_RETENTION_DAYS"),
        }),
      inject: [PrismaService, ConfigService],
    },
    { provide: DOCUMENT_MAINTENANCE_STORAGE, useExisting: DOCUMENT_STORAGE },
    {
      provide: DocumentReprocessUseCase,
      useFactory: (repo: DocumentLifecycleRepository) =>
        new DocumentReprocessUseCase(repo),
      inject: [DOCUMENT_LIFECYCLE_REPOSITORY],
    },
    {
      provide: DocumentLifecycleMaintenance,
      useFactory: (
        repo: DocumentLifecycleRepository,
        storage: DocumentMaintenanceStorage,
        c: ConfigService,
      ) =>
        new DocumentLifecycleMaintenance(repo, storage, {
          bucket: c.getOrThrow("DOCUMENT_S3_BUCKET"),
          inventoryLimit: c.getOrThrow("DOCUMENT_INVENTORY_PAGE_SIZE"),
          batchSize: c.getOrThrow("DOCUMENT_MAINTENANCE_BATCH_SIZE"),
          timeoutMs: c.getOrThrow("DOCUMENT_CLEANUP_TIMEOUT_MS"),
        }),
      inject: [
        DOCUMENT_LIFECYCLE_REPOSITORY,
        DOCUMENT_MAINTENANCE_STORAGE,
        ConfigService,
      ],
    },
    {
      provide: DocumentMaintenanceWorker,
      useFactory: (
        maintenance: DocumentLifecycleMaintenance,
        c: ConfigService,
        logger: PinoLogger,
      ) =>
        new DocumentMaintenanceWorker(
          maintenance,
          {
            enabled: c.getOrThrow("DOCUMENT_MAINTENANCE_ENABLED"),
            pollMs: c.getOrThrow("DOCUMENT_MAINTENANCE_POLL_MS"),
            shutdownMs: c.getOrThrow("DOCUMENT_WORKER_SHUTDOWN_MS"),
          },
          logger,
        ),
      inject: [DocumentLifecycleMaintenance, ConfigService, PinoLogger],
    },
    {
      provide: DocumentRetrievalUseCases,
      useFactory: (
        db: PrismaService,
        provider: EmbeddingProvider,
        c: ConfigService,
      ) =>
        new DocumentRetrievalUseCases(
          new PrismaDocumentRetrievalRepository(db),
          new PrismaDocumentVectorIndex(db),
          provider,
          {
            space: {
              model: c.getOrThrow("EMBEDDING_MODEL"),
              version: c.getOrThrow("EMBEDDING_MODEL_VERSION"),
              dimensions: c.getOrThrow("EMBEDDING_DIMENSIONS"),
            },
            timeoutMs: c.getOrThrow("DOCUMENT_RETRIEVAL_TIMEOUT_MS"),
            minSimilarity: c.getOrThrow("DOCUMENT_RETRIEVAL_MIN_SIMILARITY"),
          },
        ),
      inject: [PrismaService, EMBEDDING_PROVIDER, ConfigService],
    },
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
      useFactory: (c: ConfigService) => {
        const provider = c.getOrThrow<string>("EMBEDDING_PROVIDER");
        if (provider === "fake") return new FakeEmbeddingProvider();
        const config = {
          baseUrl: c.getOrThrow<string>("EMBEDDING_BASE_URL"),
          space: {
            model: c.getOrThrow<string>("EMBEDDING_MODEL"),
            version: c.getOrThrow<string>("EMBEDDING_MODEL_VERSION"),
            dimensions: c.getOrThrow<number>("EMBEDDING_DIMENSIONS"),
          },
          batchSize: c.getOrThrow<number>("EMBEDDING_BATCH_SIZE"),
          maxInputTokens: c.getOrThrow<number>("EMBEDDING_MAX_INPUT_TOKENS"),
          timeoutMs: c.getOrThrow<number>("EMBEDDING_TIMEOUT_MS"),
          maxAttempts: c.getOrThrow<number>("EMBEDDING_MAX_ATTEMPTS"),
        };
        if (provider === "cloudflare")
          return new CloudflareEmbeddingProvider({
            ...config,
            accountId: c.getOrThrow<string>("CLOUDFLARE_ACCOUNT_ID"),
            apiToken: c.getOrThrow<string>("CLOUDFLARE_API_TOKEN"),
          });
        return new OllamaEmbeddingProvider(config);
      },
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
          cleanupPageSize: c.getOrThrow("DOCUMENT_CLEANUP_VERSION_BATCH_SIZE"),
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
