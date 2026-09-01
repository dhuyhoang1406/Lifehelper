import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type {
  AccessTokenPayload,
  TokenService,
} from "../../application/ports/auth.ports";

@Injectable()
export class JwtTokenService implements TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}
  createAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      expiresIn: this.config.getOrThrow<number>(
        "JWT_ACCESS_EXPIRES_IN_SECONDS",
      ),
      issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
      audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
    });
  }
  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
      audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
    });
    if (payload.tokenType !== "access" || !payload.sub || !payload.sessionId)
      throw new Error("Invalid access token");
    return payload;
  }
  createRefreshToken(): { raw: string; hash: string } {
    const raw = randomBytes(48).toString("base64url");
    return { raw, hash: this.hashRefreshToken(raw) };
  }
  hashRefreshToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }
}
