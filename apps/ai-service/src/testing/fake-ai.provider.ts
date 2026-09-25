import type {
  AIProvider,
  AIProviderName,
  AIRequest,
  AIResponse,
} from "../application/ports/ai-provider.port";

type FakeResult =
  | { response: AIResponse; error?: never }
  | { response?: never; error: unknown };

export class FakeAIProvider implements AIProvider {
  readonly requests: AIRequest[] = [];
  private readonly results: FakeResult[] = [];

  constructor(readonly name: AIProviderName) {}

  enqueueResponse(response: AIResponse): void {
    this.results.push({ response });
  }

  enqueueError(error: unknown): void {
    this.results.push({ error });
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    const result = this.results.shift();
    if (!result)
      throw new Error(`Fake ${this.name} provider has no queued result`);
    if ("error" in result) throw result.error;
    return result.response;
  }

  async checkHealth(): Promise<void> {}
}
