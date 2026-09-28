import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

export interface AuthenticatedAIRequest extends Request {
  auth?: { userId: string };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedAIRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        sessionId: string;
        tokenType: string;
      }>(token, {
        secret: this.config.getOrThrow("JWT_ACCESS_SECRET"),
        issuer: this.config.getOrThrow("JWT_ISSUER"),
        audience: this.config.getOrThrow("JWT_AUDIENCE"),
      });
      if (!payload.sub || !payload.sessionId || payload.tokenType !== "access")
        throw new UnauthorizedException();
      request.auth = { userId: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
