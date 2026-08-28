import { DeviceSession } from "./device-session.entity";
import { DevicePlatform } from "../enums/identity.enums";

describe("DeviceSession", () => {
  const createSession = () =>
    DeviceSession.create({
      id: "session-id",
      userId: "user-id",
      deviceId: "device-id",
      platform: DevicePlatform.ANDROID,
    });

  it("rejects a blank device id", () => {
    expect(() =>
      DeviceSession.create({
        id: "session-id",
        userId: "user-id",
        deviceId: " ",
        platform: DevicePlatform.ANDROID,
      }),
    ).toThrow("Device id");
  });

  it("does not record activity after revocation", () => {
    const session = createSession();
    session.revoke();
    expect(() => session.recordActivity()).toThrow("revoked");
  });
});
