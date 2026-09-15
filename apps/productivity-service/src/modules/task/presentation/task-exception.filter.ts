import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { TaskDomainError } from "../domain/errors/task-domain.error";
@Catch(TaskDomainError)
export class TaskExceptionFilter implements ExceptionFilter {
  catch(error: TaskDomainError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = new BadRequestException(error.message).getResponse();
    response.status(400).json(mapped);
  }
}
