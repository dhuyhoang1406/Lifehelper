export interface ServiceHealth {
  status: "ok" | "error";
  service: string;
  timestamp: string;
}

export interface CorrelatedRequest {
  correlationId: string;
}

/** UUID string used at service boundaries without coupling domain entities. */
export type UUID = string;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
