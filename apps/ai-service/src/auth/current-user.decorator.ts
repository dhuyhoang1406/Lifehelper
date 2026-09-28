import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedAIRequest } from "./jwt-auth.guard";

export const CurrentUserId = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedAIRequest>().auth?.userId,
);
