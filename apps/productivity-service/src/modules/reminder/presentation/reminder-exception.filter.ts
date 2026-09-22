import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { ReminderDomainError } from "../domain/errors/reminder-domain.error";
@Catch(ReminderDomainError)
export class ReminderExceptionFilter implements ExceptionFilter {
  catch(error: ReminderDomainError, host: ArgumentsHost) {
    const mapped = new BadRequestException(error.message);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(mapped.getStatus())
      .json(mapped.getResponse());
  }
}
