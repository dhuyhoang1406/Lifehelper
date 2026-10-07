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
    const startedAt = performance.now();
    let attempts = 0;
    try {
      const response = await this.retryPolicy.execute(() => {
        attempts += 1;
        return this.provider.generate(request);
      });
      return {
        ...response,
        metadata: {
          ...response.metadata,
          totalLatencyMs: Math.round(performance.now() - startedAt),
          retryCount: attempts - 1,
        },
      };
    } catch (error) {
      throw normalizeAIProviderError(error);
    }
  }

  async checkHealth(): Promise<void> {
    try {
      await this.provider.checkHealth();
    } catch (error) {
      throw normalizeAIProviderError(error);
    }
  }
}
