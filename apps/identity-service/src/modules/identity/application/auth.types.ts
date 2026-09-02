import type { UUID } from "@lifehelper/shared-types";
import type { DevicePlatform } from "../domain/enums/identity.enums";

export interface DeviceInput {
  deviceId: string;
  platform: DevicePlatform;
  deviceName?: string;
}
export interface AuthenticatedUser {
  userId: UUID;
  sessionId: UUID;
}
export interface AuthResult {
  user: { id: UUID; email: string; displayName: string; avatarUrl: string | null };
  accessToken: string;
  refreshToken: string;
  session: { id: UUID; deviceId: string; deviceName: string | null; platform: DevicePlatform };
}
