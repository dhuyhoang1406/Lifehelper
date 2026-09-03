import type { LoginUserUseCase } from "../application/use-cases/login-user.use-case";
import type { RegisterUserUseCase } from "../application/use-cases/register-user.use-case";
import { DevicePlatform } from "../domain/enums/identity.enums";
import { AuthController } from "./auth.controller";

describe("AuthController", () => {
  it("delegates registration to the use case", async () => {
    const response = { accessToken: "access-token" };
    const registerUser = { execute: jest.fn().mockResolvedValue(response) } as unknown as RegisterUserUseCase;
    const loginUser = { execute: jest.fn() } as unknown as LoginUserUseCase;
    const controller = new AuthController(
      registerUser,
      loginUser,
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
    const controller = new AuthController(
      registerUser,
      loginUser,
    );
    const dto = {
      email: "user@example.com",
      password: "StrongPass123",
      device: { deviceId: "phone", platform: DevicePlatform.ANDROID },
    };

    await expect(controller.login(dto)).resolves.toBe(response);
    expect(loginUser.execute).toHaveBeenCalledWith(dto);
  });
});
