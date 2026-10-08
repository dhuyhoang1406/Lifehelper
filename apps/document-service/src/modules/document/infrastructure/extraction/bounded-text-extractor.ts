import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import type {
  DocumentTextExtractor,
  ExtractedText,
  ExtractionLimits,
} from "../../application/ports/document-extraction.port";
import {
  DocumentProcessingFailure,
  processingFailure,
} from "../../domain/processing-policy";
import { PDF_WORKER_SOURCE } from "./pdf-worker.source";
export class BoundedTextExtractor implements DocumentTextExtractor {
  constructor(private readonly limits: ExtractionLimits) {}
  async extract(
    bytes: Uint8Array,
    mimeType: string,
    signal: AbortSignal,
  ): Promise<ExtractedText> {
    if (signal.aborted)
      throw new DocumentProcessingFailure("DOCUMENT_PARSER_TIMEOUT");
    if (!bytes.length)
      throw new DocumentProcessingFailure("DOCUMENT_TEXT_EMPTY");
    if (bytes.length > this.limits.maxFileBytes)
      throw new DocumentProcessingFailure("DOCUMENT_FILE_LIMIT");
    const maxTextChars = Math.min(
      this.limits.maxTextChars,
      bytes.length * this.limits.maxExpansionRatio,
    );
    if (mimeType === "application/pdf") {
      if (Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-")
        throw new DocumentProcessingFailure("DOCUMENT_PDF_INVALID");
      return this.pdf(bytes, maxTextChars, signal);
    }
    if (!["text/plain", "text/markdown"].includes(mimeType))
      throw new DocumentProcessingFailure("DOCUMENT_UNSUPPORTED_INPUT");
    const start = performance.now();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new DocumentProcessingFailure("DOCUMENT_TEXT_INVALID");
    }
    if (text.includes("\0") || text.startsWith("%PDF-"))
      throw new DocumentProcessingFailure("DOCUMENT_TEXT_INVALID");
    if (text.length > maxTextChars)
      throw new DocumentProcessingFailure("DOCUMENT_TEXT_LIMIT");
    const units = text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line, index) => ({
        text: line.normalize("NFC"),
        source: index + 1,
      }));
    if (performance.now() - start >= this.limits.timeoutMs || signal.aborted)
      throw new DocumentProcessingFailure("DOCUMENT_PARSER_TIMEOUT");
    if (!units.some((unit) => unit.text.trim()))
      throw new DocumentProcessingFailure("DOCUMENT_TEXT_EMPTY");
    return { units, locatorKind: "LINE" };
  }
  private async pdf(
    bytes: Uint8Array,
    maxTextChars: number,
    signal: AbortSignal,
  ): Promise<ExtractedText> {
    const copy = Uint8Array.from(bytes);
    const worker = new Worker(PDF_WORKER_SOURCE, {
      eval: true,
      workerData: {
        bytes: copy,
        library: require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
        maxPages: this.limits.maxPages,
        maxTextChars,
      },
      transferList: [copy.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: this.limits.memoryMb,
        stackSizeMb: 4,
      },
      stdout: true,
      stderr: true,
    });
    worker.stdout?.resume();
    worker.stderr?.resume();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => undefined;
    try {
      return await new Promise<ExtractedText>((accept, reject) => {
        onAbort = () =>
          reject(new DocumentProcessingFailure("DOCUMENT_PARSER_TIMEOUT"));
        signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(onAbort, this.limits.timeoutMs);
        worker.once("error", (error) =>
          reject(
            new DocumentProcessingFailure(
              error.code === "ERR_WORKER_OUT_OF_MEMORY"
                ? "DOCUMENT_PARSER_RESOURCE_LIMIT"
                : "DOCUMENT_PDF_INVALID",
            ),
          ),
        );
        worker.once("exit", () =>
          reject(new DocumentProcessingFailure("DOCUMENT_PDF_INVALID")),
        );
        worker.once(
          "message",
          (message: {
            ok: boolean;
            code?: string;
            units?: ExtractedText["units"];
          }) => {
            if (!message.ok)
              reject(new DocumentProcessingFailure(processingFailure(message)));
            else if (
              !Array.isArray(message.units) ||
              message.units.length > maxTextChars ||
              message.units.reduce(
                (count, unit) => count + unit.text.length + 1,
                0,
              ) > maxTextChars
            )
              reject(new DocumentProcessingFailure("DOCUMENT_TEXT_LIMIT"));
            else accept({ units: message.units, locatorKind: "PAGE" });
          },
        );
        if (signal.aborted) onAbort();
      });
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      await worker.terminate();
    }
  }
}
