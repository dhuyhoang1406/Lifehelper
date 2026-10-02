import { PrismaService } from "../prisma.service";
import type { Document } from "../modules/document/domain/entities/document.entity";
import type { DocumentUploadRepository } from "../application/ports/document-upload.repository";
import { DocumentApplicationError } from "../application/errors/document.errors";
import { DocumentMapper } from "./document.persistence";
import { randomUUID } from "node:crypto";
import { documentEvent } from "./document-outbox";
export class PrismaDocumentUploadRepository implements DocumentUploadRepository {
  constructor(private readonly db: PrismaService) {}
  async reserve(
    document: Document,
    maxDocuments: number,
    maxStorageBytes: bigint,
  ) {
    await this.db.$transaction(async (tx) => {
      // Serialize reservations per owner, including concurrent first uploads.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${document.state.userId}, 0))`;
      const used = await tx.document.aggregate({
        where: { userId: document.state.userId, deletedAt: null },
        _count: { id: true },
        _sum: { sizeBytes: true },
      });
      if (
        used._count.id >= maxDocuments ||
        (used._sum.sizeBytes ?? 0n) + document.state.sizeBytes > maxStorageBytes
      )
        throw new DocumentApplicationError(
          "DOCUMENT_QUOTA_EXCEEDED",
          "Document storage quota exceeded",
          409,
        );
      await tx.document.create({
        data: DocumentMapper.toPersistence(document),
      });
      await tx.documentCleanupTask.create({
        data: {
          documentId: document.state.id,
          nextAttemptAt: document.state.uploadExpiresAt!,
          createdAt: document.state.createdAt,
        },
      });
    });
  }
  async commitUpload(
    id: string,
    userId: string,
    revision: number,
    versionId: string,
    checksumSha256: string,
    at: Date,
  ) {
    return this.db.$transaction(async (tx) => {
      const result = await tx.document.updateMany({
        where: {
          id,
          userId,
          revision,
          deletedAt: null,
          status: "PENDING_UPLOAD",
          storageVersionId: null,
          uploadExpiresAt: { gt: at },
        },
        data: {
          status: "UPLOADED",
          storageVersionId: versionId,
          checksumSha256,
          updatedAt: at,
          processingError: null,
          revision: { increment: 1 },
        },
      });
      if (!result.count) return false;
      const document = await tx.document.findUniqueOrThrow({ where: { id } });
      const generation = document.processingGeneration + 1;
      const jobId = randomUUID();
      await tx.documentGeneration.create({
        data: { documentId: id, generation, createdAt: at },
      });
      await tx.documentProcessingJob.create({
        data: {
          id: jobId,
          documentId: id,
          generation,
          nextAttemptAt: at,
          createdAt: at,
          updatedAt: at,
        },
      });
      await documentEvent(
        tx,
        "document.uploaded",
        id,
        jobId,
        generation,
        0,
        at,
      );
      return true;
    });
  }
  async deleteAndScheduleCleanup(id: string, userId: string, at: Date) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.document.updateMany({
        where: { id, userId, deletedAt: null },
        data: {
          status: "DELETED",
          deletedAt: at,
          activeGeneration: null,
          updatedAt: at,
          revision: { increment: 1 },
        },
      });
      if (!rows.count) return false;
      await tx.documentProcessingJob.updateMany({
        where: { documentId: id, status: { in: ["PENDING", "RUNNING"] } },
        data: {
          status: "CANCELLED",
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: at,
        },
      });
      await tx.documentGeneration.updateMany({
        where: { documentId: id, status: "PROCESSING" },
        data: { status: "FAILED" },
      });
      const document = await tx.document.findUniqueOrThrow({ where: { id } });
      // A reusable POST can recreate an object after deletion until it expires.
      // Delay final cleanup until that window has closed.
      const cleanupAt =
        document.uploadExpiresAt && document.uploadExpiresAt > at
          ? document.uploadExpiresAt
          : at;
      await tx.documentCleanupTask.upsert({
        where: { documentId: id },
        create: { documentId: id, nextAttemptAt: cleanupAt, createdAt: at },
        update: { nextAttemptAt: cleanupAt, completedAt: null },
      });
      return true;
    });
  }
}
