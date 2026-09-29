import { AIActionLog } from "./ai-action-log.entity";

describe("AIActionLog", () => {
  const createLog = () => {
    const action = AIActionLog.create({
      id: "action-id",
      userId: "user-id",
      toolName: "create_task",
      inputPayload: {},
    });
    action.start();
    return action;
  };

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite duration %p",
    (duration) => {
      expect(() => createLog().succeed({}, duration)).toThrow(
        "non-negative integer",
      );
    },
  );

  it("rejects sensitive fields nested in audit payloads", () => {
    expect(() =>
      AIActionLog.create({
        id: "action-id",
        userId: "user-id",
        toolName: "create_task",
        inputPayload: { headers: { authorization: "Bearer secret" } },
      }),
    ).toThrow("Sensitive field");
  });

  it("rejects sensitive fields in tool output", () => {
    expect(() => createLog().succeed({ refresh_token: "secret" }, 10)).toThrow(
      "Sensitive field",
    );
  });

  it("allows only requested to executing to final transitions", () => {
    const action = AIActionLog.create({
      id: "action-id", userId: "user-id", toolName: "create_task", inputPayload: {},
    });
    expect(() => action.succeed({}, 1)).toThrow("Only executing");
    action.start();
    expect(() => action.start()).toThrow("Only requested");
    action.succeed({ id: "task-id" }, 1);
    expect(() => action.fail("FAILED", 1)).toThrow("Only executing");
    expect(() => action.reject("REJECTED")).toThrow("Only requested");
  });
});
