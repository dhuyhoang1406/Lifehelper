import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedAIRequest } from "./jwt-auth.guard";
import { randomUUID } from "node:crypto";

export const CurrentUserId = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedAIRequest>().auth?.userId,
);

export const CurrentAIToolContext = createParamDecorator(
  (_: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<AuthenticatedAIRequest>();
    if (!request.auth) return undefined;
    const header = request.headers["x-correlation-id"];
    return {
      userId: request.auth.userId,
      accessToken: request.auth.accessToken,
      correlationId: typeof header === "string" && header.length <= 128 ? header : randomUUID(),
    };
  },
);
