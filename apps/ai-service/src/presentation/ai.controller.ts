import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AI_PROVIDER_ROUTER } from "../application/ports/ai-provider.port";
import { AIProviderRouter } from "../application/services/ai-provider.router";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MessageRole } from "../modules/ai/domain/enums/ai.enums";
import { GenerateDto } from "./generate.dto";

const SIMPLE_CHAT_MAX_OUTPUT_TOKENS = 256;
const SIMPLE_CHAT_INSTRUCTIONS =
  "Trả lời ngắn gọn bằng ngôn ngữ của người dùng. Không tự tạo sự kiện, dữ liệu cá nhân hoặc nguồn tham khảo. Nếu không có dữ liệu cần thiết, hãy nói rõ bạn không biết hoặc chưa được cung cấp dữ liệu.";

@ApiTags("AI")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("ai")
export class AIController {
  private readonly logger = new Logger(AIController.name);

  constructor(
    @Inject(AI_PROVIDER_ROUTER) private readonly router: AIProviderRouter,
  ) {}

  @Post("generate")
  @HttpCode(200)
  async generate(@Body() body: GenerateDto) {
    const response = await this.router.generate({
      messages: [
        { role: MessageRole.SYSTEM, content: SIMPLE_CHAT_INSTRUCTIONS },
        { role: MessageRole.USER, content: body.prompt },
      ],
      maxOutputTokens: SIMPLE_CHAT_MAX_OUTPUT_TOKENS,
      disableReasoning: true,
    });
    this.logger.log({
      event: "ai_generation_metrics",
      provider: response.metadata.provider,
      model: response.metadata.model,
      reportedModel: response.metadata.reportedModel,
      providerLatencyMs: response.metadata.latencyMs,
      totalLatencyMs: response.metadata.totalLatencyMs,
      retryCount: response.metadata.retryCount,
      usage: response.metadata.rawUsage,
    });
    return response;
  }
}
