import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { DeviceSession } from "../../domain/entities/device-session.entity";
import { DevicePlatform } from "../../domain/enums/identity.enums";
import { JwtAuthGuard } from "./jwt-auth.guard";
import type { TokenService } from "../../application/ports/auth.ports";
import type { DeviceSessionRepository } from "../../../../application/repositories/identity.repositories";

describe("JwtAuthGuard", () => {
  const request = {
    headers: { authorization: "Bearer access-token" },
  } as never;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const tokens = {
    verifyAccessToken: jest.fn().mockResolvedValue({
      sub: "user-1",
      sessionId: "session-1",
      tokenType: "access",
    }),
  };
  const activeSession = () =>
    DeviceSession.create({
      id: "session-1",
      userId: "user-1",
      deviceId: "device-1",
      platform: DevicePlatform.WEB,
    });
  const sessions = { findById: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    delete (request as { auth?: unknown }).auth;
  });

  it("attaches authentication for an active matching session", async () => {
    sessions.findById.mockResolvedValue(activeSession());

    await expect(
      new JwtAuthGuard(
        tokens as unknown as TokenService,
        sessions as unknown as DeviceSessionRepository,
      ).canActivate(context),
    ).resolves.toBe(true);
    expect((request as { auth?: unknown }).auth).toEqual({
      userId: "user-1",
      sessionId: "session-1",
    });
  });

  it.each([
    ["missing", null],
    [
      "owned by another user",
      DeviceSession.create({
        id: "session-1",
        userId: "user-2",
        deviceId: "device-1",
        platform: DevicePlatform.WEB,
      }),
    ],
    [
      "revoked",
      (() => {
        const session = activeSession();
        session.revoke();
        return session;
      })(),
    ],
  ])("rejects a %s session", async (_label, session) => {
    sessions.findById.mockResolvedValue(session);

    await expect(
      new JwtAuthGuard(
        tokens as unknown as TokenService,
        sessions as unknown as DeviceSessionRepository,
      ).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect((request as { auth?: unknown }).auth).toBeUndefined();
  });

  it("rejects malformed authorization", async () => {
    const missingHeader = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;

    await expect(
      new JwtAuthGuard(
        tokens as unknown as TokenService,
        sessions as unknown as DeviceSessionRepository,
      ).canActivate(missingHeader),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });
});
