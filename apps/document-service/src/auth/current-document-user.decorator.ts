import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthenticatedDocumentRequest } from "./jwt-auth.guard";
export const CurrentDocumentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedDocumentRequest>().auth?.userId;
    if (!user) throw new UnauthorizedException();
    return user;
  },
);
