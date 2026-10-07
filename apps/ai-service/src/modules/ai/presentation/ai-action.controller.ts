import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AIActionUseCases } from "../application/use-cases/ai-action.use-cases";
import type { ToolUserContext } from "../application/ports/productivity-read.port";
import { CurrentAIToolContext } from "../../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard";
import { AIActionDecisionDto, AIActionIdDto } from "./ai-action.dto";

@Controller("ai/actions")
@UseGuards(JwtAuthGuard)
@ApiTags("AI actions")
@ApiBearerAuth("access-token")
export class AIActionController {
  constructor(private readonly actions: AIActionUseCases) {}

  @Get(":id")
  get(
    @CurrentAIToolContext() context: ToolUserContext,
    @Param() params: AIActionIdDto,
  ) {
    return this.actions.get(context, params.id);
  }

  @Post(":id/confirm")
  confirm(
    @CurrentAIToolContext() context: ToolUserContext,
    @Param() params: AIActionIdDto,
    @Body() body: AIActionDecisionDto,
  ) {
    return this.actions.confirm(context, params.id, body.payloadHash);
  }

  @Post(":id/reject")
  reject(
    @CurrentAIToolContext() context: ToolUserContext,
    @Param() params: AIActionIdDto,
    @Body() body: AIActionDecisionDto,
  ) {
    return this.actions.reject(context, params.id, body.payloadHash);
  }
}
