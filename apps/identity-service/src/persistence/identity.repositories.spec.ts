import { Prisma } from "../../generated/client";
import { IdentityErrorCode } from "../modules/identity/application/errors/identity.errors";
import { User } from "../modules/identity/domain/entities/user.entity";
import { PrismaUserRepository } from "./identity.repositories";

describe("PrismaUserRepository", () => {
  const user = User.create({
    id: "user-1",
    email: "duplicate@example.com",
    displayName: "Duplicate",
    passwordHash: "hashed-password",
    createdAt: new Date("2026-09-02T04:00:00.000Z"),
  });
  const uniqueViolation = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields", {
      code: "P2002",
      clientVersion: "6.16.2",
      meta: { target },
    });

  it("maps a unique email violation to EMAIL_ALREADY_EXISTS (409)", async () => {
    const db = {
      user: { upsert: jest.fn().mockRejectedValue(uniqueViolation(["email"])) },
    };
    const repository = new PrismaUserRepository(db as never);

    await expect(repository.save(user)).rejects.toMatchObject({
      code: IdentityErrorCode.EMAIL_ALREADY_EXISTS,
      statusCode: 409,
    });
  });

  it("does not map unique violations on other fields", async () => {
    const db = {
      user: { upsert: jest.fn().mockRejectedValue(uniqueViolation(["tokenHash"])) },
    };
    const repository = new PrismaUserRepository(db as never);

    await expect(repository.save(user)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it("rethrows unrelated persistence errors", async () => {
    const boom = new Error("connection refused");
    const db = { user: { upsert: jest.fn().mockRejectedValue(boom) } };
    const repository = new PrismaUserRepository(db as never);

    await expect(repository.save(user)).rejects.toBe(boom);
  });
});
