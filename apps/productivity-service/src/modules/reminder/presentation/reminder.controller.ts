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
  CancelReminder,
  CreateReminder,
  DeleteReminder,
  GetReminder,
  ListReminders,
  UpdateReminder,
} from "../application/reminder.use-cases";
import {
  CreateReminderDto,
  ReminderIdParamDto,
  ReminderListDto,
  UpdateReminderDto,
} from "./reminder.dto";

@Controller("reminders")
@UseGuards(JwtAuthGuard)
@ApiTags("Reminders")
@ApiBearerAuth("access-token")
export class ReminderController {
  constructor(
    private readonly createReminder: CreateReminder,
    private readonly getReminder: GetReminder,
    private readonly listReminders: ListReminders,
    private readonly updateReminder: UpdateReminder,
    private readonly cancelReminder: CancelReminder,
    private readonly deleteReminder: DeleteReminder,
  ) {}
  @Post()
  @ApiBody({
    type: CreateReminderDto,
    examples: { default: { value: swaggerExamples.reminder } },
  })
  create(@CurrentUserId() userId: string, @Body() body: CreateReminderDto) {
    return this.createReminder.execute(userId, body);
  }
  @Get() list(
    @CurrentUserId() userId: string,
    @Query() query: ReminderListDto,
  ) {
    return this.listReminders.execute(userId, query);
  }
  @Get(":id") get(
    @CurrentUserId() userId: string,
    @Param() params: ReminderIdParamDto,
  ) {
    return this.getReminder.execute(userId, params.id);
  }
  @Patch(":id") update(
    @CurrentUserId() userId: string,
    @Param() params: ReminderIdParamDto,
    @Body() body: UpdateReminderDto,
  ) {
    return this.updateReminder.execute(userId, params.id, body);
  }
  @Post(":id/cancel") cancel(
    @CurrentUserId() userId: string,
    @Param() params: ReminderIdParamDto,
  ) {
    return this.cancelReminder.execute(userId, params.id);
  }
  @Delete(":id") @HttpCode(HttpStatus.NO_CONTENT) delete(
    @CurrentUserId() userId: string,
    @Param() params: ReminderIdParamDto,
  ) {
    return this.deleteReminder.execute(userId, params.id);
  }
}
