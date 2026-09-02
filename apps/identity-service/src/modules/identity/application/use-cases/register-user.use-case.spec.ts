import { ConfigService } from "@nestjs/config";
import type {
  IdentityTransactionRepositories,
  IdentityUnitOfWork,
  UserRepository,
} from "../../../../application/repositories/identity.repositories";
import { DevicePlatform } from "../../domain/enums/identity.enums";
import { IdentityErrorCode } from "../errors/identity.errors";
import type { PasswordHasher, TokenService } from "../ports/auth.ports";
import { RegisterUserUseCase } from "./register-user.use-case";

describe("RegisterUserUseCase", () => {
  const input = {
    email: " New.User@Example.com ",
    password: "StrongPass123",
    displayName: "New User",
    device: { deviceId: "phone-1", platform: DevicePlatform.ANDROID },
  };
  const users = {
    findByEmail: jest.fn(),
  } as unknown as UserRepository;
  const transactionalRepositories = {
    users: { save: jest.fn() },
    sessions: { save: jest.fn() },
    refreshTokens: { save: jest.fn() },
  } as unknown as IdentityTransactionRepositories;
  const unitOfWork = {
    run: jest.fn((work: (repositories: IdentityTransactionRepositories) => Promise<unknown>) =>
      work(transactionalRepositories),
    ),
  } as unknown as IdentityUnitOfWork;
  const passwords = {
    hash: jest.fn().mockResolvedValue("password-hash"),
  } as unknown as PasswordHasher;
  const tokens = {
    createRefreshToken: jest.fn().mockReturnValue({ raw: "raw-refresh", hash: "refresh-hash" }),
    createAccessToken: jest.fn().mockResolvedValue("access-token"),
  } as unknown as TokenService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue(3600),
  } as unknown as ConfigService;

  beforeEach(() => jest.clearAllMocks());

  it("creates the complete registration aggregate in one transaction", async () => {
    (users.findByEmail as jest.Mock).mockResolvedValue(null);
    const result = await new RegisterUserUseCase(users, unitOfWork, passwords, tokens, config).execute(input);

    expect(users.findByEmail).toHaveBeenCalledWith("new.user@example.com");
    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
    expect(transactionalRepositories.users.save).toHaveBeenCalledTimes(1);
    expect(transactionalRepositories.sessions.save).toHaveBeenCalledTimes(1);
    expect(transactionalRepositories.refreshTokens.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ accessToken: "access-token", refreshToken: "raw-refresh" });
    expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("rejects duplicate email without opening a transaction", async () => {
    (users.findByEmail as jest.Mock).mockResolvedValue({ state: { id: "existing" } });
    await expect(
      new RegisterUserUseCase(users, unitOfWork, passwords, tokens, config).execute(input),
    ).rejects.toMatchObject({ code: IdentityErrorCode.EMAIL_ALREADY_EXISTS, statusCode: 409 });
    expect(unitOfWork.run).not.toHaveBeenCalled();
    expect(passwords.hash).not.toHaveBeenCalled();
  });
});
