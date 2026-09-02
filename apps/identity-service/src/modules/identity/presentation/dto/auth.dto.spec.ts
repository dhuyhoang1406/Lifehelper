import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DevicePlatform } from "../../domain/enums/identity.enums";
import { RegisterDto } from "./auth.dto";

describe("RegisterDto", () => {
  const validRequest = {
    email: "user@example.com",
    password: "StrongPass123",
    displayName: "User",
    device: { deviceId: "phone", platform: DevicePlatform.ANDROID },
  };

  it("allows deviceName to be omitted", async () => {
    await expect(validate(plainToInstance(RegisterDto, validRequest))).resolves.toHaveLength(0);
  });

  it("validates deviceName when it is provided", async () => {
    const dto = plainToInstance(RegisterDto, {
      ...validRequest,
      device: { ...validRequest.device, deviceName: "" },
    });
    const errors = await validate(dto);
    expect(errors[0]?.children?.[0]?.property).toBe("deviceName");
  });
});
