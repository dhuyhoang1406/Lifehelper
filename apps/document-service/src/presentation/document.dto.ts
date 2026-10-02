import { Type } from "class-transformer";
import {
  IsString,
  IsInt,
  IsUUID,
  IsOptional,
  Matches,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
export class UploadDocumentDto {
  @ApiProperty({ example: "notes.txt" })
  @IsString()
  @MaxLength(255)
  filename!: string;
  @ApiProperty({ example: "text/plain" })
  @IsString()
  @MaxLength(120)
  mimeType!: string;
  @ApiProperty({ example: 20 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  sizeBytes!: number;
  @ApiPropertyOptional({
    description: "Optional expected SHA-256, lowercase hex",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  checksumSha256?: string;
}
export class DocumentIdDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() id!: string;
}
export class DocumentListDto {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
