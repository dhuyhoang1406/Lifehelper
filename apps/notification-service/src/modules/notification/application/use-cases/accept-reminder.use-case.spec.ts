import {
  AcceptReminderUseCase,
  type ReminderIntake,
} from "./accept-reminder.use-case";
import type { NotificationDispatchRepository } from "../repositories/notification-dispatch.repository";
const id = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-19T01:00:00Z");
const input: ReminderIntake = {
  userId: id,
  sourceEventId: id,
  sourceReminderId: id,
  dispatchVersion: 1,
  title: "Title",
  body: "Body",
  eligibleAt: now,
  expiresAt: new Date(now.getTime() + 60000),
};
describe("Reminder intake", () => {
  const accept = jest.fn();
  const repository: NotificationDispatchRepository = {
    accept,
    claim: jest.fn(),
    resolveTargets: jest.fn(),
    settle: jest.fn(),
    suppress: jest.fn(),
  };
  const useCase = new AcceptReminderUseCase(
    repository,
    { titleChars: 10, bodyChars: 20, dataBytes: 200 },
    () => id,
    () => now,
  );
  beforeEach(() => accept.mockReset());
  it("creates server-owned pending notification using configured bounds", async () => {
    accept.mockResolvedValue({ notificationId: id, created: true });
    await useCase.execute("due", input);
    expect(accept.mock.calls[0][1].state).toMatchObject({
      id,
      createdAt: now,
      status: "PENDING",
      readAt: null,
    });
  });
  it.each<Partial<ReminderIntake>>([
    { userId: "foreign" },
    { dispatchVersion: 0 },
    { title: "x".repeat(11) },
    { data: { token: "secret" } },
    { expiresAt: now },
  ])("rejects invalid intake before touching persistence %p", (invalid) => {
    expect(() => useCase.execute("due", { ...input, ...invalid })).toThrow();
    expect(accept).not.toHaveBeenCalled();
  });
  it("rejects an invalid consumer", () => {
    expect(() => useCase.execute("bad consumer", input)).toThrow("consumer");
  });
});
