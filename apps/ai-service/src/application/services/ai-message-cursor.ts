import type { UUID } from "@lifehelper/shared-types";
import { AIApplicationError, AIErrorCode } from "../errors/ai.errors";

export interface MessagePosition {
  createdAt: Date;
  id: UUID;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidCursor(): AIApplicationError {
  return new AIApplicationError(
    AIErrorCode.AI_INVALID_CURSOR,
    "Invalid conversation message cursor",
    400,
  );
}

export function encodeMessageCursor(
  conversationId: UUID,
  position: MessagePosition,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      conversationId,
      createdAt: position.createdAt.toISOString(),
      id: position.id,
    }),
  ).toString("base64url");
}

export function decodeMessageCursor(
  encoded: string,
  conversationId: UUID,
): MessagePosition {
  if (encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw invalidCursor();
  try {
    const value: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw invalidCursor();
    const payload = value as Record<string, unknown>;
    if (
      payload.version !== 1 ||
      payload.conversationId !== conversationId ||
      typeof payload.createdAt !== "string" ||
      typeof payload.id !== "string" ||
      !UUID_PATTERN.test(payload.id)
    )
      throw invalidCursor();
    const createdAt = new Date(payload.createdAt);
    if (
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.toISOString() !== payload.createdAt ||
      encodeMessageCursor(conversationId, { createdAt, id: payload.id }) !==
        encoded
    )
      throw invalidCursor();
    return { createdAt, id: payload.id };
  } catch {
    throw invalidCursor();
  }
}
