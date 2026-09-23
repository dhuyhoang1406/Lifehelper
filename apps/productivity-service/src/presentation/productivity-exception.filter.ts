import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Prisma } from "../../generated/client";
import { ProductivityApplicationError } from "../application/errors/productivity.errors";
import { CalendarDomainError } from "../modules/calendar/domain/errors/calendar-domain.error";
import {
  DuplicateHabitLogError,
  HabitDomainError,
} from "../modules/habit/domain/errors/habit-domain.error";
import { ReminderDomainError } from "../modules/reminder/domain/errors/reminder-domain.error";
import { TaskDomainError } from "../modules/task/domain/errors/task-domain.error";

type ProductivityDomainError =
  | TaskDomainError
  | CalendarDomainError
  | HabitDomainError
  | ReminderDomainError;

@Catch()
export class ProductivityExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProductivityExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const correlationId = request.headers["x-correlation-id"] ?? null;

    if (error instanceof ProductivityApplicationError) {
      this.logCause(error.cause);
      response.status(error.statusCode).json({
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        correlationId,
      });
      return;
    }
    if (this.isDomainError(error)) {
      const conflict = error instanceof DuplicateHabitLogError;
      response.status(conflict ? 409 : 400).json({
        statusCode: conflict ? 409 : 400,
        code: conflict ? "HABIT_LOG_ALREADY_EXISTS" : "VALIDATION_ERROR",
        message: error.message,
        correlationId,
      });
      return;
    }
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      this.log(error);
      response.status(409).json({
        statusCode: 409,
        code: "CONFLICT",
        message: "Resource already exists",
        correlationId,
      });
      return;
    }
    this.log(error);
    response.status(500).json({
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      correlationId,
    });
  }

  private isDomainError(error: unknown): error is ProductivityDomainError {
    return (
      error instanceof TaskDomainError ||
      error instanceof CalendarDomainError ||
      error instanceof HabitDomainError ||
      error instanceof ReminderDomainError
    );
  }

  private logCause(cause: unknown): void {
    if (cause !== undefined) this.log(cause);
  }

  private log(error: unknown): void {
    this.logger.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
}
