import { Transform, Type } from "class-transformer";
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsInt,
  Min,
  Max,
  IsOptional,
  ValidateIf,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsUUID,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
export class DocumentSearchDto {
  @ApiProperty({ example: "Điều kiện để được dự thi là gì?" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  query!: string;
  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 20 })
  @IsInt()
  @Min(1)
  @Max(20)
  topK = 5;
  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  documentIds?: string[];
}
export class DocumentChunksDto {
  @ApiPropertyOptional({ minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  generation?: number;
  @ApiPropertyOptional({ default: -1 })
  @Type(() => Number)
  @IsInt()
  @Min(-1)
  @Max(2147483647)
  after = -1;
  @ApiPropertyOptional({ default: 10, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}
export class DocumentChunkIdDto {
  @IsUUID() id!: string;
  @IsUUID() chunkId!: string;
}
