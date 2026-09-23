export enum ProductivityErrorCode {
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  SUBTASK_NOT_FOUND = "SUBTASK_NOT_FOUND",
  TAG_NOT_FOUND = "TAG_NOT_FOUND",
  TAG_ALREADY_EXISTS = "TAG_ALREADY_EXISTS",
  CALENDAR_EVENT_NOT_FOUND = "CALENDAR_EVENT_NOT_FOUND",
  HABIT_NOT_FOUND = "HABIT_NOT_FOUND",
  HABIT_LOG_NOT_FOUND = "HABIT_LOG_NOT_FOUND",
  HABIT_LOG_ALREADY_EXISTS = "HABIT_LOG_ALREADY_EXISTS",
  REMINDER_NOT_FOUND = "REMINDER_NOT_FOUND",
  REMINDER_RESOURCE_NOT_FOUND = "REMINDER_RESOURCE_NOT_FOUND",
}

export class ProductivityApplicationError extends Error {
  constructor(
    readonly code: ProductivityErrorCode,
    message: string,
    readonly statusCode: number,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export const productivityNotFound = (
  code: ProductivityErrorCode,
  message: string,
) => new ProductivityApplicationError(code, message, 404);

export const productivityConflict = (
  code: ProductivityErrorCode,
  message: string,
  cause?: unknown,
) => new ProductivityApplicationError(code, message, 409, cause);
