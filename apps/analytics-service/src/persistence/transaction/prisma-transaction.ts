import type { OutboxEventInput } from "@lifehelper/shared-types";
import type { Prisma } from "../../../generated/client";
import { PrismaService } from "../../prisma.service";
export class PrismaTransactionRunner {
  constructor(private readonly db: PrismaService) {}
  run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(work);
  }
}
export const writeOutbox = (
  tx: Prisma.TransactionClient,
  event: OutboxEventInput,
) =>
  tx.outboxEvent.create({
    data: { ...event, payload: event.payload as Prisma.InputJsonValue },
  });
