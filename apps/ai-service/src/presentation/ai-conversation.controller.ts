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
import { AIConversationUseCases } from "../application/services/ai-conversation.use-cases";
import { CurrentUserId } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
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
  chat(@CurrentUserId() userId: string, @Body() body: ChatDto) {
    return this.useCases.chat(userId, body.prompt, body.conversationId);
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
