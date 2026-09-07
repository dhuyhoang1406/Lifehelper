import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import type { PasswordHasher } from "../../application/ports/auth.ports";

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }
  verify(password: string, hash: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}
