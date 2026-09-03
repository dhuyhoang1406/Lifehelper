import type { RegisterUserUseCase } from "../application/use-cases/register-user.use-case";
import { DevicePlatform } from "../domain/enums/identity.enums";
import { AuthController } from "./auth.controller";

describe("AuthController", () => {
  it("delegates registration to the use case", async () => {
    const response = { accessToken: "access-token" };
    const registerUser = { execute: jest.fn().mockResolvedValue(response) } as unknown as RegisterUserUseCase;
    const controller = new AuthController(
      registerUser,
      undefined as never,
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
});
