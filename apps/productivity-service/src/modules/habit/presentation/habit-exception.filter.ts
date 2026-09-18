import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import {
  DuplicateHabitLogError,
  HabitDomainError,
} from "../domain/errors/habit-domain.error";

@Catch(HabitDomainError)
export class HabitExceptionFilter implements ExceptionFilter {
  catch(error: HabitDomainError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped =
      error instanceof DuplicateHabitLogError
        ? new ConflictException(error.message)
        : new BadRequestException(error.message);
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}
