import { DailyProductivityMetric } from "./daily-productivity-metric.entity";

describe("DailyProductivityMetric", () => {
  const input = {
    id: "metric-id",
    userId: "user-id",
    metricDate: "2026-01-01",
  };

  it("starts all counters at zero and increments a selected counter", () => {
    const metric = DailyProductivityMetric.create(input);
    metric.increment("tasksCompleted", 2);
    expect(metric.state).toMatchObject({ tasksCreated: 0, tasksCompleted: 2 });
  });

  it.each([0, -1, 1.5])("rejects invalid increment %s", (amount) => {
    expect(() =>
      DailyProductivityMetric.create(input).increment("aiRequests", amount),
    ).toThrow("positive integer");
  });

  it("rejects negative restored counters", () => {
    expect(() =>
      DailyProductivityMetric.restore({
        ...DailyProductivityMetric.create(input).state,
        tasksCreated: -1,
      }),
    ).toThrow("cannot be negative");
  });
});
