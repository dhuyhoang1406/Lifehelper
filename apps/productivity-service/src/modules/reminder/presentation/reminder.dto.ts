import { Type } from "class-transformer";
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";
import {
  ReminderResourceType,
  ReminderStatus,
} from "../domain/enums/reminder.enums";

export class CreateReminderDto {
  @IsEnum(ReminderResourceType) resourceType!: ReminderResourceType;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  resourceId?: string | null;
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @Type(() => Date) @IsDate() remindAt!: Date;
  @IsString() @MinLength(1) @MaxLength(64) timezone!: string;
}
export class UpdateReminderDto {
  @IsOptional()
  @IsEnum(ReminderResourceType)
  resourceType?: ReminderResourceType;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  resourceId?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @Type(() => Date) @IsDate() remindAt?: Date;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) timezone?: string;
}
export class ReminderListDto {
  @IsOptional() @IsEnum(ReminderStatus) status?: ReminderStatus;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class ReminderIdParamDto {
  @IsUUID() id!: string;
}
