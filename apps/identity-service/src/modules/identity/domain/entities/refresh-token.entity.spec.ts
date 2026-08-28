import { RefreshToken } from "./refresh-token.entity";

describe("RefreshToken", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const input = {
    id: "token-id",
    userId: "user-id",
    deviceSessionId: "session-id",
    tokenHash: "hash",
    tokenFamilyId: "family-id",
    expiresAt: new Date("2026-01-02T00:00:00Z"),
    createdAt: now,
  };

  it("requires an expiry after creation", () => {
    expect(() => RefreshToken.create({ ...input, expiresAt: now })).toThrow(
      "future expiry",
    );
  });

  it("prevents token reuse", () => {
    const token = RefreshToken.create(input);
    token.use("replacement-id", new Date("2026-01-01T01:00:00Z"));
    expect(() =>
      token.use("another-id", new Date("2026-01-01T02:00:00Z")),
    ).toThrow("not active");
  });

  it("prevents use after revocation", () => {
    const token = RefreshToken.create(input);
    token.revoke(now);
    expect(() => token.use("replacement-id", now)).toThrow("not active");
  });
});
