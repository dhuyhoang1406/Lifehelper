import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedAIRequest } from "./jwt-auth.guard";
import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
} from "@lifehelper/logger";

export const CurrentUserId = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedAIRequest>().auth?.userId,
);

export const CurrentAIToolContext = createParamDecorator(
  (_: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedAIRequest>();
    if (!request.auth) return undefined;
    const response = context
      .switchToHttp()
      .getResponse<{ getHeader(name: string): unknown }>();
    const correlationId = resolveCorrelationId(
      response.getHeader(CORRELATION_ID_HEADER) ??
        request.headers[CORRELATION_ID_HEADER],
    );
    return {
      userId: request.auth.userId,
      accessToken: request.auth.accessToken,
      correlationId: correlationId,
    };
  },
);
