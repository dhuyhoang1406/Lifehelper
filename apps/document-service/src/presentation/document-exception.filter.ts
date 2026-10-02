import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { DocumentApplicationError } from "../application/errors/document.errors";
@Catch(DocumentApplicationError)
export class DocumentExceptionFilter implements ExceptionFilter {
  catch(error: DocumentApplicationError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(error.statusCode).json({
      code: error.code,
      message: error.message,
      correlationId: response.getHeader("x-correlation-id") ?? null,
    });
  }
}
