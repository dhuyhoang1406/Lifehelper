import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuth2Client } from "google-auth-library";
import type { OAuthIdentity, OAuthIdentityProvider } from "../../application/ports/auth.ports";

@Injectable()
export class GoogleOAuthIdentityProvider implements OAuthIdentityProvider {
  private readonly client = new OAuth2Client();
  constructor(private readonly config: ConfigService) {}
  async verifyToken(token: string): Promise<OAuthIdentity> {
    const audience = this.config.getOrThrow<string>("GOOGLE_CLIENT_ID");
    const ticket = await this.client.verifyIdToken({ idToken: token, audience });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error("Incomplete Google identity");
    return { providerUserId: payload.sub, email: payload.email.trim().toLowerCase(), emailVerified: payload.email_verified === true, displayName: payload.name?.trim() || payload.email.split("@")[0], avatarUrl: payload.picture ?? null };
  }
}
