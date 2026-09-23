import { Type } from "class-transformer";
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import { PaginationDto } from "../../../presentation/pagination.dto";
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
export class ReminderListDto extends PaginationDto {
  @IsOptional() @IsEnum(ReminderStatus) status?: ReminderStatus;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}
export class ReminderIdParamDto {
  @IsUUID() id!: string;
}
