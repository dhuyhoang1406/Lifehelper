import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../../application/auth.types";
import type { TokenService } from "../../application/ports/auth.ports";
import { TOKEN_SERVICE } from "../../application/ports/auth.ports";
import type { DeviceSessionRepository } from "../../../../application/repositories/identity.repositories";
import { DEVICE_SESSION_REPOSITORY } from "../../../../application/repositories/identity.repositories";

export interface AuthenticatedRequest extends Request {
  auth?: AuthenticatedUser;
}
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly sessions: DeviceSessionRepository,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    try {
      const payload = await this.tokens.verifyAccessToken(token);
      const session = await this.sessions.findById(payload.sessionId);
      if (
        !session ||
        session.state.userId !== payload.sub ||
        !session.isActive()
      ) {
        throw new UnauthorizedException();
      }
      request.auth = { userId: payload.sub, sessionId: payload.sessionId };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
