import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AI_PROVIDER_ROUTER } from "../application/ports/ai-provider.port";
import { AIProviderRouter } from "../application/services/ai-provider.router";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MessageRole } from "../modules/ai/domain/enums/ai.enums";
import { GenerateDto } from "./generate.dto";

@ApiTags("AI")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("ai")
export class AIController {
  constructor(
    @Inject(AI_PROVIDER_ROUTER) private readonly router: AIProviderRouter,
  ) {}

  @Post("generate")
  @HttpCode(200)
  generate(@Body() body: GenerateDto) {
    return this.router.generate({
      messages: [{ role: MessageRole.USER, content: body.prompt }],
    });
  }
}
