import type { Prisma } from "../../generated/client";
export async function dbNow(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<
    Array<{ at: Date }>
  >`SELECT clock_timestamp() AS at`;
  return rows[0].at;
}
export async function lockDocument(
  tx: Prisma.TransactionClient,
  id: string,
  userId?: string,
) {
  const rows =
    userId === undefined
      ? await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM documents WHERE id=${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM documents WHERE id=${id}::uuid AND user_id=${userId}::uuid FOR UPDATE`;
  return rows.length ? tx.document.findUniqueOrThrow({ where: { id } }) : null;
}
