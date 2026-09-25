import { Test } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AuthController } from "./auth.controller";
import { authSwaggerExamples } from "./swagger.examples";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RegisterUserUseCase } from "../application/use-cases/register-user.use-case";
import { LoginUserUseCase } from "../application/use-cases/login-user.use-case";
import { RefreshAccessTokenUseCase } from "../application/use-cases/refresh-access-token.use-case";
import { GetCurrentUserUseCase } from "../application/use-cases/get-current-user.use-case";
import { GoogleLoginUseCase } from "../application/use-cases/google-login.use-case";
import { ListDeviceSessionsUseCase, LogoutAllSessionsUseCase, LogoutUseCase, RevokeDeviceSessionUseCase } from "../application/use-cases/session-management.use-cases";

describe("Identity Swagger documentation", () => {
  it("exposes usable auth examples and bearer requirements only for protected operations", async () => {
    const useCases = [
      RegisterUserUseCase, LoginUserUseCase, RefreshAccessTokenUseCase,
      GetCurrentUserUseCase, LogoutUseCase, LogoutAllSessionsUseCase,
      ListDeviceSessionsUseCase, RevokeDeviceSessionUseCase, GoogleLoginUseCase,
    ];
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: useCases.map((useCase) => ({ provide: useCase, useValue: { execute: jest.fn() } })),
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true }).compile();
    const app = module.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().addBearerAuth(undefined, "access-token").build(),
      );
      for (const [path, example] of [
        ["/auth/register", authSwaggerExamples.register],
        ["/auth/login", authSwaggerExamples.login],
        ["/auth/refresh", authSwaggerExamples.refresh],
        ["/auth/oauth/google", authSwaggerExamples.google],
      ] as const) {
        expect(document.paths[path]?.post?.requestBody).toMatchObject({
          content: { "application/json": { examples: { default: { value: example } } } },
        });
        expect(document.paths[path]?.post?.security).toBeUndefined();
      }
      expect(document.paths["/auth/me"]?.get?.security).toEqual([
        { "access-token": [] },
      ]);
      expect(document.components?.schemas?.RegisterDto).toMatchObject({
        required: expect.arrayContaining(["email", "password", "displayName", "device"]),
      });
    } finally {
      await app.close();
    }
  });
});
