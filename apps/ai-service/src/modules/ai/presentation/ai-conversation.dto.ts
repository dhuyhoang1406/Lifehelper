import { Transform, Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsObject,
  IsIn,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  ValidateNested,
  ValidateIf,
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

export class DocumentScopeDto {
  @ApiPropertyOptional({ enum: ["search", "summarize"], default: "search" })
  @IsIn(["search", "summarize"])
  mode: "search" | "summarize" = "search";
  @ApiPropertyOptional({
    type: [String],
    description:
      "Owned document IDs. Summarize requires exactly one; omitted search scope searches all owned READY documents.",
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === "string" ? v.toLowerCase() : v))
      : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  documentIds?: string[];
}
export class ChatDto {
  @ApiPropertyOptional({
    type: DocumentScopeDto,
    description:
      "Explicit opt-in to read-only document grounding for this turn",
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => DocumentScopeDto)
  documentScope?: DocumentScopeDto;

  @ApiProperty({ example: "Xin chào, bạn giúp tôi lập kế hoạch được không?" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16_000)
  @Matches(/\S/)
  prompt!: string;

  @ApiPropertyOptional({
    example: "Asia/Ho_Chi_Minh",
    description: "User's IANA timezone for date-based read tools",
  })
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
  @ApiPropertyOptional({
    type: Number,
    default: 1,
    minimum: 1,
    maximum: 1_000_000,
  })
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

  @ApiPropertyOptional({
    description: "Opaque nextCursor from the previous page",
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}
