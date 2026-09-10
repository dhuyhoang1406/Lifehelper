import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { IdentityApplicationError } from "../application/errors/identity.errors";
import { Prisma } from "../../../../generated/client";

@Catch()
export class IdentityExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(IdentityExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    if (error instanceof IdentityApplicationError) {
      if (error.cause !== undefined) {
        const cause = error.cause;
        this.logger.error(
          cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
        );
      }
      response.status(error.statusCode).json({ statusCode: error.statusCode, code: error.code, message: error.message, correlationId: request.headers["x-correlation-id"] ?? null });
      return;
    }
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      response.status(409).json({ statusCode: 409, code: "CONFLICT", message: "Resource already exists", correlationId: request.headers["x-correlation-id"] ?? null });
      return;
    }
    this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    response.status(500).json({ statusCode: 500, code: "INTERNAL_SERVER_ERROR", message: "Internal server error", correlationId: request.headers["x-correlation-id"] ?? null });
  }
}
