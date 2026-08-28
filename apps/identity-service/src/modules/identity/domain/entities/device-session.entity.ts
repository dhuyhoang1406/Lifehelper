import type { UUID } from "@lifehelper/shared-types";
import { DevicePlatform } from "../enums/identity.enums";
import { IdentityDomainError } from "../errors/identity-domain.error";

export interface DeviceSessionProps {
  id: UUID;
  userId: UUID;
  deviceId: string;
  deviceName: string | null;
  platform: DevicePlatform;
  pushToken: string | null;
  lastActiveAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export class DeviceSession {
  private constructor(private props: DeviceSessionProps) {}
  static create(
    input: Pick<DeviceSessionProps, "id" | "userId" | "deviceId" | "platform"> &
      Partial<
        Pick<DeviceSessionProps, "deviceName" | "pushToken" | "createdAt">
      >,
  ): DeviceSession {
    if (!input.deviceId.trim())
      throw new IdentityDomainError("Device id is required");
    const now = input.createdAt ?? new Date();
    return new DeviceSession({
      ...input,
      deviceId: input.deviceId.trim(),
      deviceName: input.deviceName ?? null,
      pushToken: input.pushToken ?? null,
      lastActiveAt: now,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  static restore(props: DeviceSessionProps): DeviceSession {
    return new DeviceSession(props);
  }
  get state(): Readonly<DeviceSessionProps> {
    return this.props;
  }
  recordActivity(at = new Date()): void {
    if (this.props.revokedAt)
      throw new IdentityDomainError("Session is revoked");
    this.props.lastActiveAt = at;
    this.props.updatedAt = at;
  }
  registerPushToken(token: string | null, at = new Date()): void {
    this.props.pushToken = token;
    this.props.updatedAt = at;
  }
  revoke(at = new Date()): void {
    this.props.revokedAt = at;
    this.props.updatedAt = at;
  }
}
