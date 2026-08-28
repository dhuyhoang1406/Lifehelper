export enum NotificationType {
  REMINDER = "REMINDER",
  TASK = "TASK",
  CALENDAR = "CALENDAR",
  HABIT = "HABIT",
  AI = "AI",
  SYSTEM = "SYSTEM",
}
export enum NotificationStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  SENT = "SENT",
  FAILED = "FAILED",
}
export enum DeliveryStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}
export enum NotificationProvider {
  FCM = "FCM",
}
