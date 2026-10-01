import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { LoggerModule as PinoLoggerModule } from "nestjs-pino";

export const CORRELATION_ID_HEADER = "x-correlation-id";

export function resolveCorrelationId(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)
    ? candidate
    : randomUUID();
}

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        genReqId: (request, response) => {
          const supplied = request.headers[CORRELATION_ID_HEADER];
          const correlationId = resolveCorrelationId(supplied);
          response.setHeader(CORRELATION_ID_HEADER, correlationId);
          return correlationId;
        },
        customProps: (request) => ({ correlationId: request.id }),
        redact: ["req.headers.authorization", "req.headers.cookie"],
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class StructuredLoggerModule {}
