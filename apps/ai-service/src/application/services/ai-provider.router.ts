import {
  AIApplicationError,
  AIErrorCode,
  normalizeAIProviderError,
} from "../errors/ai.errors";
import type {
  AIProvider,
  AIProviderName,
  AIRequest,
  AIResponse,
} from "../ports/ai-provider.port";
import { AIProviderRetryPolicy } from "./ai-provider-retry.policy";

export class AIProviderRegistry {
  private readonly providers: ReadonlyMap<AIProviderName, AIProvider>;

  constructor(providers: readonly AIProvider[]) {
    const entries = providers.map(
      (provider) => [provider.name, provider] as const,
    );
    const unique = new Map(entries);
    if (unique.size !== entries.length)
      throw new Error("Duplicate AI provider registration");
    this.providers = unique;
  }

  get(name: AIProviderName): AIProvider {
    const provider = this.providers.get(name);
    if (!provider)
      throw new AIApplicationError(
        AIErrorCode.AI_PROVIDER_UNAVAILABLE,
        `Configured AI provider '${name}' is not registered`,
        503,
      );
    return provider;
  }
}

export class AIProviderRouter {
  private readonly provider: AIProvider;

  constructor(
    selectedProvider: AIProviderName,
    registry: AIProviderRegistry,
    private readonly retryPolicy: AIProviderRetryPolicy,
  ) {
    this.provider = registry.get(selectedProvider);
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    try {
      return await this.retryPolicy.execute(() =>
        this.provider.generate(request),
      );
    } catch (error) {
      throw normalizeAIProviderError(error);
    }
  }
}
