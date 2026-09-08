import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DEVICE_SESSION_REPOSITORY, IDENTITY_UNIT_OF_WORK, OAUTH_ACCOUNT_REPOSITORY, REFRESH_TOKEN_REPOSITORY, USER_REPOSITORY } from "../src/application/repositories/identity.repositories";
import type { DeviceSession } from "../src/modules/identity/domain/entities/device-session.entity";
import type { OAuthAccount } from "../src/modules/identity/domain/entities/oauth-account.entity";
import type { RefreshToken } from "../src/modules/identity/domain/entities/refresh-token.entity";
import type { User } from "../src/modules/identity/domain/entities/user.entity";
import { PrismaService } from "../src/prisma.service";

class MemoryUsers {
  readonly values = new Map<string, User>();
  findById = async (id: string) => this.values.get(id) ?? null;
  findByEmail = async (email: string) => [...this.values.values()].find((u) => u.state.email === email.trim().toLowerCase()) ?? null;
  save = async (user: User) => { this.values.set(user.state.id, user); };
}
class MemorySessions {
  readonly values = new Map<string, DeviceSession>();
  findById = async (id: string) => this.values.get(id) ?? null;
  findByUserId = async (userId: string) => [...this.values.values()].filter((s) => s.state.userId === userId);
  findByUserAndDevice = async (userId: string, deviceId: string) => [...this.values.values()].find((s) => s.state.userId === userId && s.state.deviceId === deviceId) ?? null;
  save = async (session: DeviceSession) => { this.values.set(session.state.id, session); };
}
class MemoryTokens {
  readonly values = new Map<string, RefreshToken>();
  findByTokenHash = async (hash: string) => [...this.values.values()].find((t) => t.state.tokenHash === hash) ?? null;
  findBySessionId = async (id: string) => [...this.values.values()].filter((t) => t.state.deviceSessionId === id);
  findByUserId = async (id: string) => [...this.values.values()].filter((t) => t.state.userId === id);
  save = async (token: RefreshToken) => { this.values.set(token.state.id, token); };
}
class MemoryAccounts {
  readonly values: OAuthAccount[] = [];
  findByProviderIdentity = async (provider: string, id: string) => this.values.find((a) => a.state.provider === provider && a.state.providerUserId === id) ?? null;
  save = async (account: OAuthAccount) => { this.values.push(account); };
}

describe("Authentication flow (e2e)", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const users = new MemoryUsers();
    const sessions = new MemorySessions();
    const refreshTokens = new MemoryTokens();
    const ref = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
      .overrideProvider(USER_REPOSITORY).useValue(users)
      .overrideProvider(DEVICE_SESSION_REPOSITORY).useValue(sessions)
      .overrideProvider(REFRESH_TOKEN_REPOSITORY).useValue(refreshTokens)
      .overrideProvider(IDENTITY_UNIT_OF_WORK).useValue({
        run: (work: (repositories: unknown) => Promise<unknown>) =>
          work({ users, sessions, refreshTokens }),
      })
      .overrideProvider(OAUTH_ACCOUNT_REPOSITORY).useValue(new MemoryAccounts())
      .compile();
    app = ref.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(() => app.close());

  const device = { deviceId: "e2e-phone", platform: "ANDROID", deviceName: "Test phone" };
  const credentials = { email: "auth@example.com", password: "StrongPass123", displayName: "Auth User", device };
  let accessToken: string;
  let refreshToken: string;

  it("registers a user", async () => {
    const result = await request(app.getHttpServer()).post("/auth/register").send(credentials).expect(201);
    accessToken = result.body.accessToken; refreshToken = result.body.refreshToken;
    expect(result.body.user).toMatchObject({ email: credentials.email, displayName: credentials.displayName });
    expect(result.body.user.passwordHash).toBeUndefined();
  });
  it("rejects duplicate email", () => request(app.getHttpServer()).post("/auth/register").send(credentials).expect(409));
  it("does not reveal whether the password is wrong", () => request(app.getHttpServer()).post("/auth/login").send({ email: credentials.email, password: "WrongPass123", device }).expect(401).expect(({ body }) => expect(body.code).toBe("INVALID_CREDENTIALS")));
  it("logs in and returns the current user", async () => {
    const login = await request(app.getHttpServer()).post("/auth/login").send({ email: credentials.email, password: credentials.password, device }).expect(201);
    accessToken = login.body.accessToken; refreshToken = login.body.refreshToken;
    await request(app.getHttpServer()).get("/auth/me").set("authorization", `Bearer ${accessToken}`).expect(200).expect(({ body }) => expect(body.email).toBe(credentials.email));
  });
  it("rejects an unauthenticated current-user request", () => request(app.getHttpServer()).get("/auth/me").expect(401));
  it("rotates refresh tokens and rejects replay", async () => {
    const rotated = await request(app.getHttpServer()).post("/auth/refresh").send({ refreshToken }).expect(201);
    expect(rotated.body.refreshToken).not.toBe(refreshToken);
    await request(app.getHttpServer()).post("/auth/refresh").send({ refreshToken }).expect(401);
  });
  it("logs out the current session", () => request(app.getHttpServer()).post("/auth/logout").set("authorization", `Bearer ${accessToken}`).expect(204));
});
