import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AIConversationUseCases } from "../application/use-cases/ai-conversation.use-cases";
import type { ToolUserContext } from "../application/ports/productivity-read.port";
import {
  CurrentAIToolContext,
  CurrentUserId,
} from "../../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard";
import {
  ChatDto,
  ConversationIdDto,
  ConversationMessagesQueryDto,
  ConversationPageDto,
} from "./ai-conversation.dto";

@ApiTags("AI conversations")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("ai")
export class AIConversationController {
  constructor(private readonly useCases: AIConversationUseCases) {}

  @Post("chat")
  @HttpCode(HttpStatus.OK)
  chat(
    @CurrentAIToolContext() context: ToolUserContext,
    @Body() body: ChatDto,
  ) {
    return this.useCases.chat(
      context.userId,
      body.prompt,
      body.conversationId,
      context,
      body.timezone,
    );
  }

  @Get("conversations")
  list(@CurrentUserId() userId: string, @Query() query: ConversationPageDto) {
    return this.useCases.list(userId, query);
  }

  @Get("conversations/:id")
  get(
    @CurrentUserId() userId: string,
    @Param() params: ConversationIdDto,
    @Query() query: ConversationMessagesQueryDto,
  ) {
    return this.useCases.get(userId, params.id, query);
  }

  @Delete("conversations/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUserId() userId: string, @Param() params: ConversationIdDto) {
    return this.useCases.delete(userId, params.id);
  }
}
