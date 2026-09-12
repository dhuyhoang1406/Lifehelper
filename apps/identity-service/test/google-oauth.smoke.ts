import type { ConfigService } from "@nestjs/config";
import { GoogleOAuthIdentityProvider } from "../src/modules/identity/infrastructure/security/google-oauth.provider";

describe("Google OAuth smoke test", () => {
  it("verifies a real Google ID token for the configured client", async () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const idToken = process.env.GOOGLE_ID_TOKEN;
    if (!clientId || !idToken) {
      throw new Error(
        "GOOGLE_CLIENT_ID and GOOGLE_ID_TOKEN are required for the opt-in smoke test",
      );
    }
    const config = {
      getOrThrow: (key: string) => {
        if (key !== "GOOGLE_CLIENT_ID")
          throw new Error(`Unexpected key: ${key}`);
        return clientId;
      },
    } as ConfigService;

    const identity = await new GoogleOAuthIdentityProvider(config).verifyToken(
      idToken,
    );

    expect(identity.providerUserId).toBeTruthy();
    expect(identity.email).toContain("@");
    expect(identity.emailVerified).toBe(true);
  });
});
