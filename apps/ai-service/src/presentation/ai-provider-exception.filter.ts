import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { AIApplicationError } from "../application/errors/ai.errors";

@Catch(AIApplicationError)
export class AIProviderExceptionFilter implements ExceptionFilter {
  catch(error: AIApplicationError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const correlationId = response.getHeader("x-correlation-id") ?? request.headers["x-correlation-id"];
    response.status(error.statusCode).json({
      code: error.code,
      message: error.message,
      correlationId: typeof correlationId === "string" ? correlationId : null,
    });
  }
}
