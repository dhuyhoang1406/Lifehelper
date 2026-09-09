import type { UserRepository } from "../../../../application/repositories/identity.repositories";
import { User } from "../../domain/entities/user.entity";
import { UserStatus } from "../../domain/enums/identity.enums";
import { IdentityErrorCode } from "../errors/identity.errors";
import { GetCurrentUserUseCase } from "./get-current-user.use-case";

describe("GetCurrentUserUseCase", () => {
  const users = { findById: jest.fn() } as unknown as UserRepository;
  const build = () => new GetCurrentUserUseCase(users);

  beforeEach(() => jest.clearAllMocks());

  it("returns a safe profile for an active user", async () => {
    const user = User.create({
      id: "user-1",
      email: "user@example.com",
      displayName: "User",
      passwordHash: "must-not-be-returned",
      avatarUrl: "https://example.com/avatar.png",
    });
    (users.findById as jest.Mock).mockResolvedValue(user);

    const result = await build().execute("user-1");

    expect(users.findById).toHaveBeenCalledWith("user-1");
    expect(result).toEqual({
      id: "user-1",
      email: "user@example.com",
      displayName: "User",
      avatarUrl: "https://example.com/avatar.png",
      status: UserStatus.ACTIVE,
      emailVerifiedAt: null,
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("returns USER_NOT_FOUND when the user does not exist", async () => {
    (users.findById as jest.Mock).mockResolvedValue(null);

    await expect(build().execute("missing-user")).rejects.toMatchObject({
      code: IdentityErrorCode.USER_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("does not expose a user that cannot authenticate", async () => {
    const suspended = User.create({
      id: "user-2",
      email: "suspended@example.com",
      displayName: "Suspended User",
      status: UserStatus.SUSPENDED,
    });
    (users.findById as jest.Mock).mockResolvedValue(suspended);

    await expect(build().execute("user-2")).rejects.toMatchObject({
      code: IdentityErrorCode.USER_NOT_FOUND,
      statusCode: 404,
    });
  });
});
