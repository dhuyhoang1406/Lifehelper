import { ConfigService } from "@nestjs/config";
import type {
  DeviceSessionRepository,
  IdentityTransactionRepositories,
  IdentityUnitOfWork,
  UserRepository,
} from "../../../../application/repositories/identity.repositories";
import { DeviceSession } from "../../domain/entities/device-session.entity";
import { User } from "../../domain/entities/user.entity";
import { DevicePlatform, UserStatus } from "../../domain/enums/identity.enums";
import { IdentityErrorCode } from "../errors/identity.errors";
import type { PasswordHasher, TokenService } from "../ports/auth.ports";
import { DUMMY_PASSWORD_HASH, LoginUserUseCase } from "./login-user.use-case";

describe("LoginUserUseCase", () => {
  const input = {
    email: " User@Example.com ",
    password: "CorrectPass123",
    device: { deviceId: "phone-1", platform: DevicePlatform.ANDROID },
  };
  const userWithPassword = User.create({
    id: "user-1",
    email: "user@example.com",
    displayName: "User",
    passwordHash: "hashed-password",
    createdAt: new Date("2026-09-03T00:00:00.000Z"),
  });
  const users = { findByEmail: jest.fn() } as unknown as UserRepository;
  const sessions = { findByUserAndDevice: jest.fn() } as unknown as DeviceSessionRepository;
  const transactional = {
    users: { save: jest.fn() },
    sessions: { save: jest.fn() },
    refreshTokens: { save: jest.fn() },
  } as unknown as IdentityTransactionRepositories;
  const unitOfWork = {
    run: jest.fn((work: (repositories: IdentityTransactionRepositories) => Promise<unknown>) =>
      work(transactional),
    ),
  } as unknown as IdentityUnitOfWork;
  const passwords = { verify: jest.fn(), hash: jest.fn() } as unknown as PasswordHasher;
  const tokens = {
    createRefreshToken: jest.fn().mockReturnValue({ raw: "raw-refresh", hash: "refresh-hash" }),
    createAccessToken: jest.fn().mockResolvedValue("access-token"),
  } as unknown as TokenService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue(3600),
  } as unknown as ConfigService;

  beforeEach(() => jest.clearAllMocks());

  const build = () =>
    new LoginUserUseCase(users, sessions, unitOfWork, passwords, tokens, config);

  it("logs in with valid credentials and persists aggregate in one transaction", async () => {
    (users.findByEmail as jest.Mock).mockResolvedValue(userWithPassword);
    (sessions.findByUserAndDevice as jest.Mock).mockResolvedValue(null);
    (passwords.verify as jest.Mock).mockResolvedValue(true);

    const result = await build().execute(input);

    expect(users.findByEmail).toHaveBeenCalledWith("user@example.com");
    expect(passwords.verify).toHaveBeenCalledWith("CorrectPass123", "hashed-password");
    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
    expect(transactional.users.save).toHaveBeenCalledTimes(1);
    expect(transactional.sessions.save).toHaveBeenCalledTimes(1);
    expect(transactional.refreshTokens.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ accessToken: "access-token", refreshToken: "raw-refresh", session: { deviceId: "phone-1" } });
  });

  it("rejects an invalid password without persisting anything", async () => {
    (users.findByEmail as jest.Mock).mockResolvedValue(userWithPassword);
    (passwords.verify as jest.Mock).mockResolvedValue(false);

    await expect(build().execute(input)).rejects.toMatchObject({
      code: IdentityErrorCode.INVALID_CREDENTIALS,
      statusCode: 401,
    });
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it("rejects an unknown email while still verifying against a dummy hash", async () => {
    (users.findByEmail as jest.Mock).mockResolvedValue(null);
    (passwords.verify as jest.Mock).mockResolvedValue(false);

    await expect(build().execute(input)).rejects.toMatchObject({
      code: IdentityErrorCode.INVALID_CREDENTIALS,
      statusCode: 401,
    });
    expect(passwords.verify).toHaveBeenCalledWith("CorrectPass123", DUMMY_PASSWORD_HASH);
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it("rejects an account without a password hash using a dummy hash", async () => {
    const noPasswordUser = User.create({
      id: "user-2",
      email: "oauth@example.com",
      displayName: "OAuth User",
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
    });
    (users.findByEmail as jest.Mock).mockResolvedValue(noPasswordUser);
    (passwords.verify as jest.Mock).mockResolvedValue(false);

    await expect(build().execute(input)).rejects.toMatchObject({
      code: IdentityErrorCode.INVALID_CREDENTIALS,
      statusCode: 401,
    });
    expect(passwords.verify).toHaveBeenCalledWith("CorrectPass123", DUMMY_PASSWORD_HASH);
  });

  it("rejects a disabled account even with valid credentials", async () => {
    const suspendedUser = User.create({
      id: "user-3",
      email: "suspended@example.com",
      displayName: "Suspended",
      passwordHash: "hashed-password",
      status: UserStatus.SUSPENDED,
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
    });
    (users.findByEmail as jest.Mock).mockResolvedValue(suspendedUser);
    (passwords.verify as jest.Mock).mockResolvedValue(true);

    await expect(build().execute(input)).rejects.toMatchObject({
      code: IdentityErrorCode.INVALID_CREDENTIALS,
      statusCode: 401,
    });
    expect(unitOfWork.run).not.toHaveBeenCalled();
  });

  it("resumes an existing device session and saves it", async () => {
    const session = DeviceSession.create({
      id: "session-1",
      userId: userWithPassword.state.id,
      deviceId: "phone-1",
      platform: DevicePlatform.ANDROID,
      createdAt: new Date("2026-09-03T00:00:00.000Z"),
    });
    (users.findByEmail as jest.Mock).mockResolvedValue(userWithPassword);
    (sessions.findByUserAndDevice as jest.Mock).mockResolvedValue(session);
    (passwords.verify as jest.Mock).mockResolvedValue(true);
    const resume = jest.spyOn(session, "resume");

    await build().execute(input);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(transactional.sessions.save).toHaveBeenCalledWith(session);
    expect(transactional.refreshTokens.save).toHaveBeenCalledTimes(1);
  });

  it("creates a new session when the device is unknown", async () => {
    (users.findByEmail as jest.Mock).mockResolvedValue(userWithPassword);
    (sessions.findByUserAndDevice as jest.Mock).mockResolvedValue(null);
    (passwords.verify as jest.Mock).mockResolvedValue(true);

    const result = await build().execute(input);

    const savedSession = (transactional.sessions.save as jest.Mock).mock.calls[0][0];
    expect(savedSession.state.userId).toBe("user-1");
    expect(savedSession.state.deviceId).toBe("phone-1");
    expect(result.session.deviceId).toBe("phone-1");
  });
});
