import type {
  User as UserRecord,
  OAuthAccount as OAuthRecord,
  DeviceSession as SessionRecord,
  RefreshToken as TokenRecord,
} from "../../generated/client";
import { User } from "../modules/identity/domain/entities/user.entity";
import { OAuthAccount } from "../modules/identity/domain/entities/oauth-account.entity";
import { DeviceSession } from "../modules/identity/domain/entities/device-session.entity";
import { RefreshToken } from "../modules/identity/domain/entities/refresh-token.entity";
import {
  DevicePlatform,
  OAuthProvider,
  UserStatus,
} from "../modules/identity/domain/enums/identity.enums";
export const UserMapper = {
  toDomain: (r: UserRecord) =>
    User.restore({ ...r, status: r.status as UserStatus }),
  toPersistence: (e: User) => e.state,
};
export const OAuthAccountMapper = {
  toDomain: (r: OAuthRecord) =>
    OAuthAccount.restore({ ...r, provider: r.provider as OAuthProvider }),
  toPersistence: (e: OAuthAccount) => e.state,
};
export const DeviceSessionMapper = {
  toDomain: (r: SessionRecord) =>
    DeviceSession.restore({ ...r, platform: r.platform as DevicePlatform }),
  toPersistence: (e: DeviceSession) => e.state,
};
export const RefreshTokenMapper = {
  toDomain: (r: TokenRecord) => RefreshToken.restore(r),
  toPersistence: (e: RefreshToken) => e.state,
};
