import { User } from "./user.entity";
import { UserStatus } from "../enums/identity.enums";

describe("User", () => {
  const input = {
    id: "user-id",
    email: " User@Example.com ",
    displayName: "User",
  };

  it("normalizes email and applies the active default", () => {
    expect(User.create(input).state).toMatchObject({
      email: "user@example.com",
      status: UserStatus.ACTIVE,
    });
  });

  it("rejects blank required profile fields", () => {
    expect(() => User.create({ ...input, email: " " })).toThrow("email");
    expect(() => User.create({ ...input, displayName: " " })).toThrow(
      "display name",
    );
  });

  it("keeps delete status and timestamp consistent", () => {
    const user = User.create(input);
    const deletedAt = new Date("2026-01-01T00:00:00Z");
    user.delete(deletedAt);
    expect(user.state).toMatchObject({ status: UserStatus.DELETED, deletedAt });
  });
});
