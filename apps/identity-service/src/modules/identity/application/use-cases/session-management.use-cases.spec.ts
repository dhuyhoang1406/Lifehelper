import type {
  DeviceSessionRepository,
  RefreshTokenRepository,
} from "../../../../application/repositories/identity.repositories";
import { DeviceSession } from "../../domain/entities/device-session.entity";
import { RefreshToken } from "../../domain/entities/refresh-token.entity";
import { DevicePlatform } from "../../domain/enums/identity.enums";
import { IdentityErrorCode } from "../errors/identity.errors";
import {
  ListDeviceSessionsUseCase,
  LogoutAllSessionsUseCase,
  LogoutUseCase,
  RevokeDeviceSessionUseCase,
} from "./session-management.use-cases";

describe("Session management use cases", () => {
  const sessions = {
    findById: jest.fn(),
    findByUserId: jest.fn(),
    save: jest.fn(),
  } as unknown as DeviceSessionRepository;
  const tokens = {
    findBySessionId: jest.fn(),
    findByUserId: jest.fn(),
    save: jest.fn(),
  } as unknown as RefreshTokenRepository;
  const auth = { userId: "user-1", sessionId: "session-1" };

  const createSession = (id = "session-1") =>
    DeviceSession.create({
      id,
      userId: "user-1",
      deviceId: `device-${id}`,
      deviceName: "Phone",
      platform: DevicePlatform.ANDROID,
    });
  const createToken = (id: string, sessionId = "session-1") =>
    RefreshToken.create({
      id,
      userId: "user-1",
      deviceSessionId: sessionId,
      tokenHash: `hash-${id}`,
      tokenFamilyId: "family-1",
      expiresAt: new Date(Date.now() + 60_000),
    });

  beforeEach(() => jest.clearAllMocks());

  it("logs out an owned session and persists only active refresh tokens", async () => {
    const session = createSession();
    const active = createToken("active-token");
    const inactive = createToken("inactive-token");
    inactive.revoke();
    (sessions.findById as jest.Mock).mockResolvedValue(session);
    (tokens.findBySessionId as jest.Mock).mockResolvedValue([active, inactive]);

    await new LogoutUseCase(sessions, tokens).execute(auth);

    expect(session.isActive()).toBe(false);
    expect(active.isActive()).toBe(false);
    expect(tokens.save).toHaveBeenCalledTimes(1);
    expect(tokens.save).toHaveBeenCalledWith(active);
    expect(sessions.save).toHaveBeenCalledWith(session);
  });

  it("keeps the original revocation time and does not rewrite an inactive session", async () => {
    const session = createSession();
    const originalRevokedAt = new Date("2026-09-05T10:00:00.000Z");
    session.revoke(originalRevokedAt);
    const activeToken = createToken("active-token");
    (sessions.findById as jest.Mock).mockResolvedValue(session);
    (tokens.findBySessionId as jest.Mock).mockResolvedValue([activeToken]);

    await new LogoutUseCase(sessions, tokens).execute(auth);

    expect(session.state.revokedAt).toEqual(originalRevokedAt);
    expect(sessions.save).not.toHaveBeenCalled();
    expect(tokens.save).toHaveBeenCalledWith(activeToken);
  });

  it("returns SESSION_NOT_FOUND without revealing another user's session", async () => {
    const session = createSession();
    (sessions.findById as jest.Mock).mockResolvedValue(session);

    await expect(
      new RevokeDeviceSessionUseCase(sessions, tokens).execute(
        { userId: "different-user", sessionId: "other-current-session" },
        session.state.id,
      ),
    ).rejects.toMatchObject({
      code: IdentityErrorCode.SESSION_NOT_FOUND,
      statusCode: 404,
    });
    expect(tokens.findBySessionId).not.toHaveBeenCalled();
    expect(sessions.save).not.toHaveBeenCalled();
  });

  it("returns SESSION_NOT_FOUND when the session does not exist", async () => {
    (sessions.findById as jest.Mock).mockResolvedValue(null);

    await expect(new LogoutUseCase(sessions, tokens).execute(auth)).rejects.toMatchObject({
      code: IdentityErrorCode.SESSION_NOT_FOUND,
      statusCode: 404,
    });
  });

  it("logs out all devices without rewriting already inactive records", async () => {
    const activeSession = createSession("active-session");
    const inactiveSession = createSession("inactive-session");
    inactiveSession.revoke();
    const activeToken = createToken("active-token", activeSession.state.id);
    const inactiveToken = createToken("inactive-token", inactiveSession.state.id);
    inactiveToken.revoke();
    (sessions.findByUserId as jest.Mock).mockResolvedValue([
      activeSession,
      inactiveSession,
    ]);
    (tokens.findByUserId as jest.Mock).mockResolvedValue([
      activeToken,
      inactiveToken,
    ]);

    await new LogoutAllSessionsUseCase(sessions, tokens).execute("user-1");

    expect(sessions.save).toHaveBeenCalledTimes(1);
    expect(sessions.save).toHaveBeenCalledWith(activeSession);
    expect(tokens.save).toHaveBeenCalledTimes(1);
    expect(tokens.save).toHaveBeenCalledWith(activeToken);
  });

  it("lists only the safe device-session projection", async () => {
    const session = createSession();
    (sessions.findByUserId as jest.Mock).mockResolvedValue([session]);

    await expect(
      new ListDeviceSessionsUseCase(sessions).execute("user-1"),
    ).resolves.toEqual([
      {
        id: "session-1",
        deviceId: "device-session-1",
        deviceName: "Phone",
        platform: DevicePlatform.ANDROID,
        lastActiveAt: session.state.lastActiveAt,
        revokedAt: null,
      },
    ]);
  });
});
