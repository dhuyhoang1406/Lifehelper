import { EventProcessingLog } from "./event-processing-log.entity";

describe("EventProcessingLog", () => {
  const input = {
    eventId: "event-id",
    eventType: "task.completed",
    consumer: "analytics-service",
  };

  it("requires non-blank event type and consumer", () => {
    expect(() =>
      EventProcessingLog.create({ ...input, eventType: " " }),
    ).toThrow("required");
    expect(() =>
      EventProcessingLog.create({ ...input, consumer: " " }),
    ).toThrow("required");
  });
});
