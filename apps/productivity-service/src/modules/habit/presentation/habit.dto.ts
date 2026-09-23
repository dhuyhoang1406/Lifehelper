import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { HabitFrequency } from "../domain/enums/habit-frequency.enum";
import { PaginationDto } from "../../../presentation/pagination.dto";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export class HabitScheduleDto {
  @IsOptional() @IsInt() @Min(1) @Max(7) dayOfWeek!: number | null;
  @IsOptional() @IsString() @Matches(TIME_PATTERN) timeOfDay!: string | null;
}
export class CreateHabitDto {
  @IsString() @MinLength(1) @MaxLength(180) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(HabitFrequency) frequencyType!: HabitFrequency;
  @IsString() @MinLength(1) @MaxLength(64) timezone!: string;
  @IsOptional() @IsInt() @Min(1) targetCount?: number;
  @IsString() @Matches(DATE_PATTERN) startDate!: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN) endDate?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HabitScheduleDto)
  schedules?: HabitScheduleDto[];
}
export class UpdateHabitDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(180) name?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(HabitFrequency) frequencyType?: HabitFrequency;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) timezone?: string;
  @IsOptional() @IsInt() @Min(1) targetCount?: number;
  @IsOptional() @IsString() @Matches(DATE_PATTERN) startDate?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN) endDate?: string | null;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HabitScheduleDto)
  schedules?: HabitScheduleDto[];
}
export class HabitListDto extends PaginationDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}
export class LogHabitCompletionDto {
  @IsString() @Matches(DATE_PATTERN) logDate!: string;
  @IsOptional() @IsInt() @Min(1) completedCount?: number;
  @IsOptional() @Type(() => Date) @IsDate() completedAt?: Date;
}
export class UpdateHabitLogDto {
  @IsOptional() @IsInt() @Min(1) completedCount?: number;
  @IsOptional() @Type(() => Date) @IsDate() completedAt?: Date;
}
export class HabitLogListDto extends PaginationDto {
  @IsOptional() @IsString() @Matches(DATE_PATTERN) from?: string;
  @IsOptional() @IsString() @Matches(DATE_PATTERN) to?: string;
}
export class HabitIdParamDto {
  @IsUUID() id!: string;
}
export class HabitLogIdParamDto extends HabitIdParamDto {
  @IsUUID() logId!: string;
}
