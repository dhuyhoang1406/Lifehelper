import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ChatDto {
  @ApiProperty({ example: "Xin chào, bạn giúp tôi lập kế hoạch được không?" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16_000)
  @Matches(/\S/)
  prompt!: string;

  @ApiPropertyOptional({ example: "Asia/Ho_Chi_Minh", description: "User's IANA timezone for date-based read tools" })
  @IsOptional()
  @IsString()
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Omit to start a new conversation",
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class ConversationIdDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;
}

export class ConversationPageDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1, maximum: 1_000_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ConversationMessagesQueryDto {
  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: "Opaque nextCursor from the previous page" })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}
