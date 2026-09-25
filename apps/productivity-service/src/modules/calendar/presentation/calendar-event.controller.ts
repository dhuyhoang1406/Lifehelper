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
  CreateCalendarEvent,
  DeleteCalendarEvent,
  GetCalendarEvent,
  ListCalendarEvents,
  UpdateCalendarEvent,
} from "../application/calendar-event.use-cases";
import {
  CalendarEventListDto,
  CalendarEventIdParamDto,
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from "./calendar-event.dto";

@Controller("calendar-events")
@UseGuards(JwtAuthGuard)
@ApiTags("Calendar events")
@ApiBearerAuth("access-token")
export class CalendarEventController {
  constructor(
    private readonly createEvent: CreateCalendarEvent,
    private readonly getEvent: GetCalendarEvent,
    private readonly listEvents: ListCalendarEvents,
    private readonly updateEvent: UpdateCalendarEvent,
    private readonly deleteEvent: DeleteCalendarEvent,
  ) {}
  @Post()
  @ApiBody({
    type: CreateCalendarEventDto,
    examples: { default: { value: swaggerExamples.calendarEvent } },
  })
  create(
    @CurrentUserId() userId: string,
    @Body() body: CreateCalendarEventDto,
  ) {
    return this.createEvent.execute(userId, body);
  }
  @Get() list(
    @CurrentUserId() userId: string,
    @Query() query: CalendarEventListDto,
  ) {
    return this.listEvents.execute(
      userId,
      query.from,
      query.to,
      query.page,
      query.limit,
    );
  }
  @Get(":id") get(
    @CurrentUserId() userId: string,
    @Param() params: CalendarEventIdParamDto,
  ) {
    return this.getEvent.execute(userId, params.id);
  }
  @Patch(":id")
  @ApiBody({ type: UpdateCalendarEventDto, examples: { default: { value: swaggerExamples.calendarEventUpdate } } })
  update(
    @CurrentUserId() userId: string,
    @Param() params: CalendarEventIdParamDto,
    @Body() body: UpdateCalendarEventDto,
  ) {
    return this.updateEvent.execute(userId, params.id, body);
  }
  @Delete(":id") @HttpCode(HttpStatus.NO_CONTENT) delete(
    @CurrentUserId() userId: string,
    @Param() params: CalendarEventIdParamDto,
  ) {
    return this.deleteEvent.execute(userId, params.id);
  }
}
