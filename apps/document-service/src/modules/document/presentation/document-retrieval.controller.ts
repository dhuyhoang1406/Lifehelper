import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard";
import { CurrentDocumentUser } from "../../../auth/current-document-user.decorator";
import { DocumentRetrievalUseCases } from "../application/use-cases/document-retrieval.use-cases";
import { DocumentExceptionFilter } from "./document-exception.filter";
import { DocumentIdDto } from "./document.dto";
import {
  DocumentSearchDto,
  DocumentChunksDto,
  DocumentChunkIdDto,
} from "./document-retrieval.dto";
@ApiTags("Internal document retrieval")
@ApiBearerAuth("access-token")
@Controller("internal/documents")
@UseGuards(JwtAuthGuard)
@UseFilters(DocumentExceptionFilter)
export class DocumentRetrievalController {
  constructor(private readonly retrieval: DocumentRetrievalUseCases) {}
  @Post("search")
  @HttpCode(200)
  search(
    @CurrentDocumentUser() user: string,
    @Body() input: DocumentSearchDto,
  ) {
    return this.retrieval.search(user, input);
  }
  @Get(":id/chunks")
  chunks(
    @CurrentDocumentUser() user: string,
    @Param() params: DocumentIdDto,
    @Query() input: DocumentChunksDto,
  ) {
    return this.retrieval.chunks(user, params.id, input);
  }
  @Get(":id/chunks/:chunkId")
  chunk(
    @CurrentDocumentUser() user: string,
    @Param() params: DocumentChunkIdDto,
    @Query() input: DocumentChunksDto,
  ) {
    return this.retrieval.chunk(
      user,
      params.id,
      params.chunkId,
      input.generation,
    );
  }
}
