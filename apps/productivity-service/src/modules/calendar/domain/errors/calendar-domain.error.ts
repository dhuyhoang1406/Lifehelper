export class CalendarDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidCalendarRangeError extends CalendarDomainError {
  constructor() {
    super("Calendar event end must be after start");
    this.name = "InvalidCalendarRangeError";
  }
}
