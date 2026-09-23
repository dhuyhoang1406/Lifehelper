import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { PaginationDto } from "../../../presentation/pagination.dto";
import { TaskPriority, TaskStatus } from "../domain/enums/task.enums";
export class CreateTaskDto {
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @Type(() => Date) @IsDate() dueAt?: Date;
  @IsOptional() @IsInt() @Min(1) estimatedMinutes?: number;
}
export class UpdateTaskDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @Type(() => Date) @IsDate() dueAt?: Date | null;
  @IsOptional() @IsInt() @Min(1) estimatedMinutes?: number | null;
}
export class TaskListDto extends PaginationDto {
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @Type(() => Date) @IsDate() dueAt?: Date;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(["createdAt", "updatedAt", "dueAt", "priority"]) sort?:
    "createdAt" | "updatedAt" | "dueAt" | "priority";
  @IsOptional() @IsIn(["asc", "desc"]) direction?: "asc" | "desc";
}
export class CreateSubtaskDto {
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsOptional() @IsInt() @Min(0) position = 0;
}
export class UpdateSubtaskDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
  @IsOptional() @IsBoolean() completed?: boolean;
}
export class TagDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
}
export class IdParamDto {
  @IsUUID() id!: string;
}
