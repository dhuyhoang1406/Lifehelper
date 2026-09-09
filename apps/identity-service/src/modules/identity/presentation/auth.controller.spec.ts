import type { LoginUserUseCase } from "../application/use-cases/login-user.use-case";
import type { RegisterUserUseCase } from "../application/use-cases/register-user.use-case";
import type { RefreshAccessTokenUseCase } from "../application/use-cases/refresh-access-token.use-case";
import type { GetCurrentUserUseCase } from "../application/use-cases/get-current-user.use-case";
import type {
  ListDeviceSessionsUseCase,
  LogoutAllSessionsUseCase,
  LogoutUseCase,
  RevokeDeviceSessionUseCase,
} from "../application/use-cases/session-management.use-cases";
import { DevicePlatform } from "../domain/enums/identity.enums";
import { AuthController } from "./auth.controller";

describe("AuthController", () => {
  const logoutUser = { execute: jest.fn() } as unknown as LogoutUseCase;
  const logoutAll = { execute: jest.fn() } as unknown as LogoutAllSessionsUseCase;
  const listSessions = { execute: jest.fn() } as unknown as ListDeviceSessionsUseCase;
  const revokeSession = { execute: jest.fn() } as unknown as RevokeDeviceSessionUseCase;
  const createController = () =>
    new AuthController(
      { execute: jest.fn() } as unknown as RegisterUserUseCase,
      { execute: jest.fn() } as unknown as LoginUserUseCase,
      { execute: jest.fn() } as unknown as RefreshAccessTokenUseCase,
      { execute: jest.fn() } as unknown as GetCurrentUserUseCase,
      logoutUser,
      logoutAll,
      listSessions,
      revokeSession,
    );

  beforeEach(() => jest.clearAllMocks());

  it("delegates registration to the use case", async () => {
    const response = { accessToken: "access-token" };
    const registerUser = { execute: jest.fn().mockResolvedValue(response) } as unknown as RegisterUserUseCase;
    const loginUser = { execute: jest.fn() } as unknown as LoginUserUseCase;
    const refreshAccessToken = { execute: jest.fn() } as unknown as RefreshAccessTokenUseCase;
    const getCurrentUser = { execute: jest.fn() } as unknown as GetCurrentUserUseCase;
    const controller = new AuthController(
      registerUser,
      loginUser,
      refreshAccessToken,
      getCurrentUser,
      logoutUser,
      logoutAll,
      listSessions,
      revokeSession,
    );
    const dto = {
      email: "user@example.com",
      password: "StrongPass123",
      displayName: "User",
      device: { deviceId: "phone", platform: DevicePlatform.ANDROID },
    };

    await expect(controller.register(dto)).resolves.toBe(response);
    expect(registerUser.execute).toHaveBeenCalledWith(dto);
  });

  it("delegates login to the use case", async () => {
    const response = { accessToken: "access-token", refreshToken: "raw-refresh" };
    const registerUser = { execute: jest.fn() } as unknown as RegisterUserUseCase;
    const loginUser = { execute: jest.fn().mockResolvedValue(response) } as unknown as LoginUserUseCase;
    const refreshAccessToken = { execute: jest.fn() } as unknown as RefreshAccessTokenUseCase;
    const getCurrentUser = { execute: jest.fn() } as unknown as GetCurrentUserUseCase;
    const controller = new AuthController(
      registerUser,
      loginUser,
      refreshAccessToken,
      getCurrentUser,
      logoutUser,
      logoutAll,
      listSessions,
      revokeSession,
    );
    const dto = {
      email: "user@example.com",
      password: "StrongPass123",
      device: { deviceId: "phone", platform: DevicePlatform.ANDROID },
    };

    await expect(controller.login(dto)).resolves.toBe(response);
    expect(loginUser.execute).toHaveBeenCalledWith(dto);
  });

  it("delegates token refresh to the use case", async () => {
    const response = { accessToken: "new-access", refreshToken: "new-refresh" };
    const registerUser = { execute: jest.fn() } as unknown as RegisterUserUseCase;
    const loginUser = { execute: jest.fn() } as unknown as LoginUserUseCase;
    const refreshAccessToken = {
      execute: jest.fn().mockResolvedValue(response),
    } as unknown as RefreshAccessTokenUseCase;
    const getCurrentUser = { execute: jest.fn() } as unknown as GetCurrentUserUseCase;
    const controller = new AuthController(
      registerUser,
      loginUser,
      refreshAccessToken,
      getCurrentUser,
      logoutUser,
      logoutAll,
      listSessions,
      revokeSession,
    );

    await expect(
      controller.refresh({ refreshToken: "current-refresh" }),
    ).resolves.toBe(response);
    expect(refreshAccessToken.execute).toHaveBeenCalledWith("current-refresh");
  });

  it("delegates current-user lookup using the authenticated user id", async () => {
    const response = { id: "user-1", email: "user@example.com" };
    const registerUser = { execute: jest.fn() } as unknown as RegisterUserUseCase;
    const loginUser = { execute: jest.fn() } as unknown as LoginUserUseCase;
    const refreshAccessToken = { execute: jest.fn() } as unknown as RefreshAccessTokenUseCase;
    const getCurrentUser = {
      execute: jest.fn().mockResolvedValue(response),
    } as unknown as GetCurrentUserUseCase;
    const controller = new AuthController(
      registerUser,
      loginUser,
      refreshAccessToken,
      getCurrentUser,
      logoutUser,
      logoutAll,
      listSessions,
      revokeSession,
    );

    await expect(
      controller.me({ userId: "user-1", sessionId: "session-1" }),
    ).resolves.toBe(response);
    expect(getCurrentUser.execute).toHaveBeenCalledWith("user-1");
  });

  it("delegates logout using the complete authentication context", async () => {
    const auth = { userId: "user-1", sessionId: "session-1" };
    (logoutUser.execute as jest.Mock).mockResolvedValue(undefined);

    await expect(createController().logout(auth)).resolves.toBeUndefined();
    expect(logoutUser.execute).toHaveBeenCalledWith(auth);
  });

  it("delegates logout-all using the authenticated user id", async () => {
    (logoutAll.execute as jest.Mock).mockResolvedValue(undefined);

    await expect(
      createController().logoutEverywhere({
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).resolves.toBeUndefined();
    expect(logoutAll.execute).toHaveBeenCalledWith("user-1");
  });

  it("delegates device-session listing using the authenticated user id", async () => {
    const response = [{ id: "session-1" }];
    (listSessions.execute as jest.Mock).mockResolvedValue(response);

    await expect(
      createController().sessions({
        userId: "user-1",
        sessionId: "session-1",
      }),
    ).resolves.toBe(response);
    expect(listSessions.execute).toHaveBeenCalledWith("user-1");
  });

  it("delegates session revocation with ownership context", async () => {
    const auth = { userId: "user-1", sessionId: "current-session" };
    (revokeSession.execute as jest.Mock).mockResolvedValue(undefined);

    await expect(
      createController().revoke(auth, "target-session"),
    ).resolves.toBeUndefined();
    expect(revokeSession.execute).toHaveBeenCalledWith(auth, "target-session");
  });
});
