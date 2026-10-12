import type { AIToolCall } from "../ports/ai-provider.port";
import { AIToolRegistry } from "./ai-tool-registry";
const tools = new AIToolRegistry({
  listTasks: jest.fn(),
  listCalendar: jest.fn(),
});
it.each<Omit<AIToolCall, "id">>([
  { name: "search_documents", arguments: { query: " " } },
  { name: "search_documents", arguments: { query: "x", topK: 21 } },
  { name: "search_documents", arguments: { query: "x", userId: "foreign" } },
  { name: "search_documents", arguments: { query: "x", vector: [1, 0] } },
  { name: "summarize_document", arguments: { documentId: "not-uuid" } },
  {
    name: "summarize_document",
    arguments: {
      documentId: "00000000-0000-4000-8000-000000000001",
      url: "http://evil",
    },
  },
])("rejects unsafe document tool arguments %j", (call) => {
  expect(() => tools.validate({ id: "call", ...call })).toThrow();
});
