import { Tag } from "./tag.entity";

describe("Tag", () => {
  it("rejects blank and overlong names", () => {
    expect(() =>
      Tag.create({ id: "tag-id", userId: "user-id", name: " " }),
    ).toThrow("Invalid tag name");
    expect(() =>
      Tag.create({ id: "tag-id", userId: "user-id", name: "x".repeat(81) }),
    ).toThrow("Invalid tag name");
  });
});
