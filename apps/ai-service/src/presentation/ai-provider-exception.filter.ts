import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { AIApplicationError } from "../application/errors/ai.errors";

@Catch(AIApplicationError)
export class AIProviderExceptionFilter implements ExceptionFilter {
  catch(error: AIApplicationError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(error.statusCode).json({
      code: error.code,
      message: error.message,
    });
  }
}
