import { AIActionLog } from "./ai-action-log.entity";

describe("AIActionLog", () => {
  const createLog = () =>
    AIActionLog.create({
      id: "action-id",
      userId: "user-id",
      toolName: "create_task",
      inputPayload: {},
    });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite duration %p",
    (duration) => {
      expect(() => createLog().succeed({}, duration)).toThrow("finite");
    },
  );
});
