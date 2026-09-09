import { ConfigService } from "@nestjs/config";
import { GoogleOAuthIdentityProvider } from "./google-oauth.provider";

const mockVerifyIdToken = jest.fn();
jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

describe("GoogleOAuthIdentityProvider", () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue("google-client-id"),
  } as unknown as ConfigService;

  beforeEach(() => jest.clearAllMocks());

  it("verifies audience and normalizes the Google identity", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-1",
        email: " User@Example.com ",
        email_verified: true,
        name: " User Name ",
        picture: "https://example.com/avatar.png",
      }),
    });

    await expect(new GoogleOAuthIdentityProvider(config).verifyToken("id-token")).resolves.toEqual({
      providerUserId: "google-1",
      email: "user@example.com",
      emailVerified: true,
      displayName: "User Name",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: "id-token",
      audience: "google-client-id",
    });
  });

  it("rejects an incomplete identity payload", async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ email: "user@example.com" }) });

    await expect(
      new GoogleOAuthIdentityProvider(config).verifyToken("id-token"),
    ).rejects.toThrow("Incomplete Google identity");
  });
});
