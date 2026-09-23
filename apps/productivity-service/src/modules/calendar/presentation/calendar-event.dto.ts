import { Type } from "class-transformer";
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { PaginationDto } from "../../../presentation/pagination.dto";
import { CalendarEventType } from "../domain/enums/calendar-event-type.enum";

export class CreateCalendarEventDto {
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(CalendarEventType) eventType!: CalendarEventType;
  @Type(() => Date) @IsDate() startAt!: Date;
  @Type(() => Date) @IsDate() endAt!: Date;
  @IsString() @MinLength(1) @MaxLength(64) timezone!: string;
  @IsOptional() @IsString() @MaxLength(255) location?: string;
  @IsOptional() @IsString() recurrenceRule?: string;
}

export class UpdateCalendarEventDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(CalendarEventType) eventType?: CalendarEventType;
  @IsOptional() @Type(() => Date) @IsDate() startAt?: Date;
  @IsOptional() @Type(() => Date) @IsDate() endAt?: Date;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(255) location?: string | null;
  @IsOptional() @IsString() recurrenceRule?: string | null;
}

export class CalendarEventListDto extends PaginationDto {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class CalendarEventIdParamDto {
  @IsUUID() id!: string;
}
