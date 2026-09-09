export enum IdentityErrorCode {
  EMAIL_ALREADY_EXISTS = "EMAIL_ALREADY_EXISTS",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  USER_NOT_FOUND = "USER_NOT_FOUND",
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  SESSION_REVOKED = "SESSION_REVOKED",
  REFRESH_TOKEN_INVALID = "REFRESH_TOKEN_INVALID",
  REFRESH_TOKEN_EXPIRED = "REFRESH_TOKEN_EXPIRED",
  OAUTH_TOKEN_INVALID = "OAUTH_TOKEN_INVALID",
  FORBIDDEN = "FORBIDDEN",
}

export class IdentityApplicationError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    message: string,
    readonly statusCode: number,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}
