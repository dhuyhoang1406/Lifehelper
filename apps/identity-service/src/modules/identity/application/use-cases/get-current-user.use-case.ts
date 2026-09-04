import { Inject, Injectable } from "@nestjs/common";
import type { UserRepository } from "../../../../application/repositories/identity.repositories";
import { USER_REPOSITORY } from "../../../../application/repositories/identity.repositories";
import { IdentityApplicationError, IdentityErrorCode } from "../errors/identity.errors";

@Injectable()
export class GetCurrentUserUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}
  async execute(userId: string) {
    const user = await this.users.findById(userId);
    if (!user || !user.canAuthenticate()) throw new IdentityApplicationError(IdentityErrorCode.USER_NOT_FOUND, "User not found", 404);
    return { id: user.state.id, email: user.state.email, displayName: user.state.displayName, avatarUrl: user.state.avatarUrl, status: user.state.status, emailVerifiedAt: user.state.emailVerifiedAt };
  }
}
