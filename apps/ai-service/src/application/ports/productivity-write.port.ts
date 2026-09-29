import type { AIJsonObject } from "./ai-provider.port";
import type { ToolUserContext } from "./productivity-read.port";
import type { ValidatedWriteCall } from "../services/ai-write-tools";

export interface ProductivityWriteClient {
  execute(context: ToolUserContext, call: ValidatedWriteCall, idempotencyKey: string): Promise<AIJsonObject>;
}
export const PRODUCTIVITY_WRITE_CLIENT = Symbol("PRODUCTIVITY_WRITE_CLIENT");
