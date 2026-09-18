export class HabitDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DuplicateHabitLogError extends HabitDomainError {
  constructor() {
    super("Habit completion is already logged for this date");
    this.name = "DuplicateHabitLogError";
  }
}
