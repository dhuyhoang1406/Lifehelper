export interface ToolUserContext {
  userId: string;
  accessToken: string;
  correlationId: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
}

export interface CalendarSummary {
  id: string;
  title: string;
  eventType: string;
  startAt: string;
  endAt: string;
  timezone: string;
}

export interface ProductivityReadClient {
  listTasks(
    context: ToolUserContext,
    query: {
      page: number;
      limit: number;
      status?: string;
      search?: string;
      dueFrom?: string;
      dueTo?: string;
    },
  ): Promise<{ items: TaskSummary[]; total: number }>;
  listCalendar(
    context: ToolUserContext,
    query: { from: string; to: string; limit: number },
  ): Promise<CalendarSummary[]>;
}

export const PRODUCTIVITY_READ_CLIENT = Symbol("PRODUCTIVITY_READ_CLIENT");
