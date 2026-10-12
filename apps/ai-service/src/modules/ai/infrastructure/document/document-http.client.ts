import type { ToolUserContext } from "../../application/ports/productivity-read.port";
import type {
  DocumentReadClient,
  DocumentChunk,
  DocumentSearchMatch,
} from "../../application/ports/document-read.port";
import {
  AIApplicationError,
  AIErrorCode,
} from "../../application/errors/ai.errors";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const int = (v: unknown, min = 0): v is number =>
  Number.isSafeInteger(v) && Number(v) >= min;
const invalid = () =>
  new AIApplicationError(
    AIErrorCode.AI_DOCUMENT_INVALID_RESPONSE,
    "Document Service returned invalid data",
    502,
  );
function passage(v: unknown) {
  if (
    !object(v) ||
    !uuid(v.documentId) ||
    !uuid(v.chunkId) ||
    !int(v.generation, 1) ||
    !int(v.chunkIndex) ||
    typeof v.filename !== "string" ||
    !v.filename ||
    v.filename.length > 255 ||
    !object(v.locator) ||
    !["LINE", "PAGE"].includes(String(v.locator.kind)) ||
    !int(v.locator.start, 1) ||
    !int(v.locator.end, Number(v.locator.start))
  )
    throw invalid();
  return {
    documentId: v.documentId,
    chunkId: v.chunkId,
    generation: v.generation,
    chunkIndex: v.chunkIndex,
    filename: v.filename,
    locator: {
      kind: v.locator.kind as "LINE" | "PAGE",
      start: v.locator.start,
      end: v.locator.end,
    },
  };
}
function chunk(v: unknown): DocumentChunk {
  const p = passage(v);
  if (
    !object(v) ||
    typeof v.content !== "string" ||
    !v.content ||
    v.content.length > 32768
  )
    throw invalid();
  return { ...p, content: v.content };
}
export class DocumentHttpClient implements DocumentReadClient {
  private readonly base: URL;
  constructor(
    baseUrl: string,
    private readonly timeoutMs: number,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.base = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.pathname !== "/" ||
      this.base.search ||
      this.base.hash
    )
      throw new Error("Document service URL must be an HTTP origin");
  }
  async search(
    context: ToolUserContext,
    input: { query: string; topK: number; documentIds?: readonly string[] },
  ): Promise<readonly DocumentSearchMatch[]> {
    const value = await this.request(
      context,
      "internal/documents/search",
      input,
    );
    if (
      !object(value) ||
      !Array.isArray(value.items) ||
      value.items.length > input.topK
    )
      throw invalid();
    const items = value.items.map((v: unknown) => {
      const p = passage(v);
      if (
        !object(v) ||
        typeof v.excerpt !== "string" ||
        !v.excerpt ||
        v.excerpt.length > 2400 ||
        typeof v.similarity !== "number" ||
        !Number.isFinite(v.similarity) ||
        v.similarity < -1 ||
        v.similarity > 1
      )
        throw invalid();
      if (input.documentIds && !input.documentIds.includes(p.documentId))
        throw invalid();
      return { ...p, excerpt: v.excerpt, similarity: v.similarity };
    });
    if (new Set(items.map((i) => i.chunkId)).size !== items.length)
      throw invalid();
    return items;
  }
  async chunks(
    context: ToolUserContext,
    documentId: string,
    input: { limit: number; generation?: number; after?: number },
  ) {
    const params = new URLSearchParams({ limit: String(input.limit) });
    if (input.generation !== undefined)
      params.set("generation", String(input.generation));
    if (input.after !== undefined) params.set("after", String(input.after));
    const value = await this.request(
      context,
      `internal/documents/${documentId}/chunks?${params}`,
    );
    if (
      !object(value) ||
      !Array.isArray(value.items) ||
      value.items.length > input.limit
    )
      throw invalid();
    const items = value.items.map(chunk);
    if (
      items.some(
        (v, i) =>
          v.documentId !== documentId ||
          (input.generation !== undefined &&
            v.generation !== input.generation) ||
          v.generation !== items[0].generation ||
          v.chunkIndex <= (i ? items[i - 1].chunkIndex : (input.after ?? -1)),
      ) ||
      items.reduce((n, v) => n + v.content.length, 0) > 32768
    )
      throw invalid();
    let next: { generation: number; after: number } | null = null;
    if (value.next !== null) {
      if (
        !object(value.next) ||
        !int(value.next.generation, 1) ||
        !int(value.next.after) ||
        !items.length ||
        value.next.generation !== items.at(-1)!.generation ||
        value.next.after !== items.at(-1)!.chunkIndex
      )
        throw invalid();
      next = { generation: value.next.generation, after: value.next.after };
    }
    return { items, next };
  }
  async chunk(
    context: ToolUserContext,
    documentId: string,
    chunkId: string,
    generation: number,
  ) {
    const result = chunk(
      await this.request(
        context,
        `internal/documents/${documentId}/chunks/${chunkId}?generation=${generation}`,
      ),
    );
    if (
      result.documentId !== documentId ||
      result.chunkId !== chunkId ||
      result.generation !== generation
    )
      throw invalid();
    return result;
  }
  private async request(
    context: ToolUserContext,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(new URL(path, this.base), {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: {
          authorization: "Bearer " + context.accessToken,
          "x-correlation-id": context.correlationId,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const status = response.status;
        const code =
          status === 404
            ? AIErrorCode.AI_DOCUMENT_NOT_FOUND
            : status === 429
              ? AIErrorCode.AI_DOCUMENT_QUOTA
              : status === 504 || status === 408
                ? AIErrorCode.AI_DOCUMENT_TIMEOUT
                : AIErrorCode.AI_DOCUMENT_UNAVAILABLE;
        throw new AIApplicationError(
          code,
          "Document request failed",
          status === 404
            ? 404
            : status === 429
              ? 429
              : status === 504 || status === 408
                ? 504
                : 503,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw invalid();
      const buffers: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 300000) {
            await reader.cancel();
            throw invalid();
          }
          buffers.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(buffers).toString("utf8")) as unknown;
      } catch {
        throw invalid();
      }
    } catch (error) {
      if (error instanceof AIApplicationError) throw error;
      throw new AIApplicationError(
        controller.signal.aborted
          ? AIErrorCode.AI_DOCUMENT_TIMEOUT
          : AIErrorCode.AI_DOCUMENT_UNAVAILABLE,
        "Document request failed",
        controller.signal.aborted ? 504 : 503,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
