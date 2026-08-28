import { OAuthAccount } from "./oauth-account.entity";
import { OAuthProvider } from "../enums/identity.enums";

describe("OAuthAccount", () => {
  it("requires a non-blank provider user id", () => {
    expect(() =>
      OAuthAccount.create({
        id: "oauth-id",
        userId: "user-id",
        provider: OAuthProvider.GOOGLE,
        providerUserId: "   ",
      }),
    ).toThrow("Provider user id");
  });
});
