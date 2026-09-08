import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { IdentityApplicationError } from "../application/errors/identity.errors";

@Catch()
export class IdentityExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(IdentityExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    if (error instanceof IdentityApplicationError) {
      response.status(error.statusCode).json({ statusCode: error.statusCode, code: error.code, message: error.message, correlationId: request.headers["x-correlation-id"] ?? null });
      return;
    }
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    response.status(500).json({ statusCode: 500, code: "INTERNAL_SERVER_ERROR", message: "Internal server error", correlationId: request.headers["x-correlation-id"] ?? null });
  }
}
