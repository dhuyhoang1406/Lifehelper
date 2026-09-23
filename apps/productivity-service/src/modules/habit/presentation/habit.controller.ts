import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiTags } from "@nestjs/swagger";
import { CurrentUserId } from "../../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard";
import { swaggerExamples } from "../../../presentation/swagger.examples";
import {
  ArchiveHabit,
  CreateHabit,
  GetHabit,
  GetHabitLogs,
  ListHabits,
  LogHabitCompletion,
  PauseHabit,
  ResumeHabit,
  UpdateHabit,
  UpdateHabitLog,
} from "../application/habit.use-cases";
import {
  CreateHabitDto,
  HabitIdParamDto,
  HabitListDto,
  HabitLogIdParamDto,
  HabitLogListDto,
  LogHabitCompletionDto,
  UpdateHabitDto,
  UpdateHabitLogDto,
} from "./habit.dto";

@Controller("habits")
@UseGuards(JwtAuthGuard)
@ApiTags("Habits")
@ApiBearerAuth("access-token")
export class HabitController {
  constructor(
    private readonly createHabit: CreateHabit,
    private readonly getHabit: GetHabit,
    private readonly listHabits: ListHabits,
    private readonly updateHabit: UpdateHabit,
    private readonly pauseHabit: PauseHabit,
    private readonly resumeHabit: ResumeHabit,
    private readonly archiveHabit: ArchiveHabit,
    private readonly logCompletion: LogHabitCompletion,
    private readonly getLogs: GetHabitLogs,
    private readonly updateLog: UpdateHabitLog,
  ) {}
  @Post()
  @ApiBody({
    type: CreateHabitDto,
    examples: { default: { value: swaggerExamples.habit } },
  })
  create(@CurrentUserId() userId: string, @Body() body: CreateHabitDto) {
    return this.createHabit.execute(userId, body);
  }
  @Get() list(@CurrentUserId() userId: string, @Query() query: HabitListDto) {
    return this.listHabits.execute(userId, query);
  }
  @Get(":id") get(
    @CurrentUserId() userId: string,
    @Param() params: HabitIdParamDto,
  ) {
    return this.getHabit.execute(userId, params.id);
  }
  @Patch(":id") update(
    @CurrentUserId() userId: string,
    @Param() params: HabitIdParamDto,
    @Body() body: UpdateHabitDto,
  ) {
    return this.updateHabit.execute(userId, params.id, body);
  }
  @Post(":id/pause") pause(
    @CurrentUserId() userId: string,
    @Param() params: HabitIdParamDto,
  ) {
    return this.pauseHabit.execute(userId, params.id);
  }
  @Post(":id/resume") resume(
    @CurrentUserId() userId: string,
    @Param() params: HabitIdParamDto,
  ) {
    return this.resumeHabit.execute(userId, params.id);
  }
  @Delete(":id") @HttpCode(HttpStatus.NO_CONTENT) archive(
    @CurrentUserId() userId: string,
    @Param() params: HabitIdParamDto,
  ) {
    return this.archiveHabit.execute(userId, params.id);
  }
  @Post(":id/logs")
  @ApiBody({
    type: LogHabitCompletionDto,
    examples: { default: { value: swaggerExamples.habitLog } },
  })
  log(
    @CurrentUserId() userId: string,
    @Param() params: HabitIdParamDto,
    @Body() body: LogHabitCompletionDto,
  ) {
    return this.logCompletion.execute(userId, params.id, body);
  }
  @Get(":id/logs") logs(
    @CurrentUserId() userId: string,
    @Param() params: HabitIdParamDto,
    @Query() query: HabitLogListDto,
  ) {
    return this.getLogs.execute(userId, params.id, query);
  }
  @Patch(":id/logs/:logId") patchLog(
    @CurrentUserId() userId: string,
    @Param() params: HabitLogIdParamDto,
    @Body() body: UpdateHabitLogDto,
  ) {
    return this.updateLog.execute(userId, params.id, params.logId, body);
  }
}
