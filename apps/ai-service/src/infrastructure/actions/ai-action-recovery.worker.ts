import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AI_ACTION_LOG_REPOSITORY,
  type AIActionLogRepository,
} from "../../application/repositories/ai.repositories";

const SWEEP_MS = 60_000;
const INTERRUPTED_GRACE_MS = 60_000;

@Injectable()
export class AIActionRecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AIActionRecoveryWorker.name);
  private timer?: NodeJS.Timeout;
  constructor(
    @Inject(AI_ACTION_LOG_REPOSITORY)
    private readonly actions: AIActionLogRepository,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>("NODE_ENV") === "test") return;
    await this.sweep();
    this.timer = setInterval(() => {
      void this.sweep().catch(() =>
        this.logger.warn("AI action recovery sweep failed"),
      );
    }, SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    const now = new Date();
    await this.actions.recoverStale(
      now,
      new Date(now.getTime() - INTERRUPTED_GRACE_MS),
    );
  }
}
