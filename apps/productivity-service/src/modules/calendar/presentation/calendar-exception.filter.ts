import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { CalendarDomainError } from "../domain/errors/calendar-domain.error";

@Catch(CalendarDomainError)
export class CalendarExceptionFilter implements ExceptionFilter {
  catch(error: CalendarDomainError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(400).json(new BadRequestException(error.message).getResponse());
  }
}
