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
import { TaskUseCases } from "../application/task.use-cases";
import {
  CreateSubtaskDto,
  CreateTaskDto,
  IdParamDto,
  TagDto,
  TaskListDto,
  UpdateSubtaskDto,
  UpdateTaskDto,
} from "./task.dto";
@Controller()
@UseGuards(JwtAuthGuard)
@ApiTags("Tasks and tags")
@ApiBearerAuth("access-token")
export class TaskController {
  constructor(private readonly useCases: TaskUseCases) {}
  @Post("tasks")
  @ApiBody({
    type: CreateTaskDto,
    examples: { default: { value: swaggerExamples.task } },
  })
  create(@CurrentUserId() userId: string, @Body() body: CreateTaskDto) {
    return this.useCases.create(userId, body);
  }
  @Get("tasks") list(
    @CurrentUserId() userId: string,
    @Query() query: TaskListDto,
  ) {
    return this.useCases.list(userId, query);
  }
  @Get("tasks/:id") get(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
  ) {
    return this.useCases.get(userId, params.id);
  }
  @Patch("tasks/:id")
  @ApiBody({ type: UpdateTaskDto, examples: { default: { value: swaggerExamples.taskUpdate } } })
  update(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
    @Body() body: UpdateTaskDto,
  ) {
    return this.useCases.update(userId, params.id, body);
  }
  @Delete("tasks/:id") @HttpCode(HttpStatus.NO_CONTENT) delete(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
  ) {
    return this.useCases.delete(userId, params.id);
  }
  @Post("tasks/:id/complete") complete(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
  ) {
    return this.useCases.transition(userId, params.id, "complete");
  }
  @Post("tasks/:id/reopen") reopen(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
  ) {
    return this.useCases.transition(userId, params.id, "reopen");
  }
  @Post("tasks/:id/cancel") cancel(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
  ) {
    return this.useCases.transition(userId, params.id, "cancel");
  }
  @Post("tasks/:id/subtasks")
  @ApiBody({
    type: CreateSubtaskDto,
    examples: { default: { value: swaggerExamples.subtask } },
  })
  createSubtask(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
    @Body() body: CreateSubtaskDto,
  ) {
    return this.useCases.createSubtask(userId, params.id, body);
  }
  @Patch("tasks/:id/subtasks/:subtaskId")
  @ApiBody({ type: UpdateSubtaskDto, examples: { default: { value: swaggerExamples.subtaskUpdate } } })
  updateSubtask(
    @CurrentUserId() userId: string,
    @Param("id") taskId: string,
    @Param("subtaskId") id: string,
    @Body() body: UpdateSubtaskDto,
  ) {
    return this.useCases.updateSubtask(userId, taskId, id, body);
  }
  @Delete("tasks/:id/subtasks/:subtaskId")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSubtask(
    @CurrentUserId() userId: string,
    @Param("id") taskId: string,
    @Param("subtaskId") id: string,
  ) {
    return this.useCases.deleteSubtask(userId, taskId, id);
  }
  @Get("tags") tags(@CurrentUserId() userId: string) {
    return this.useCases.listTags(userId);
  }
  @Post("tags")
  @ApiBody({
    type: TagDto,
    examples: { default: { value: swaggerExamples.tag } },
  })
  createTag(@CurrentUserId() userId: string, @Body() body: TagDto) {
    return this.useCases.createTag(userId, body.name);
  }
  @Patch("tags/:id")
  @ApiBody({ type: TagDto, examples: { default: { value: swaggerExamples.tagUpdate } } })
  renameTag(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
    @Body() body: TagDto,
  ) {
    return this.useCases.renameTag(userId, params.id, body.name);
  }
  @Delete("tags/:id") @HttpCode(HttpStatus.NO_CONTENT) deleteTag(
    @CurrentUserId() userId: string,
    @Param() params: IdParamDto,
  ) {
    return this.useCases.deleteTag(userId, params.id);
  }
  @Post("tasks/:id/tags/:tagId") @HttpCode(HttpStatus.NO_CONTENT) attach(
    @CurrentUserId() userId: string,
    @Param("id") taskId: string,
    @Param("tagId") tagId: string,
  ) {
    return this.useCases.attachTag(userId, taskId, tagId);
  }
  @Delete("tasks/:id/tags/:tagId") @HttpCode(HttpStatus.NO_CONTENT) detach(
    @CurrentUserId() userId: string,
    @Param("id") taskId: string,
    @Param("tagId") tagId: string,
  ) {
    return this.useCases.detachTag(userId, taskId, tagId);
  }
}
