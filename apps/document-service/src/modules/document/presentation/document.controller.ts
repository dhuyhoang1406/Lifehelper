import { DocumentReprocessUseCase } from "../application/use-cases/document-reprocess.use-case";
import {
  Body,
  Headers,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiHeader,
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiBody,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../auth/jwt-auth.guard";
import { CurrentDocumentUser } from "../../../auth/current-document-user.decorator";
import { DocumentUploadUseCases } from "../application/use-cases/document-upload.use-cases";
import { DocumentProcessingRetryUseCase } from "../application/use-cases/document-processing-retry.use-case";
import { DocumentExceptionFilter } from "./document-exception.filter";
import {
  UploadDocumentDto,
  DocumentIdDto,
  DocumentListDto,
} from "./document.dto";
@ApiTags("Documents")
@ApiBearerAuth("access-token")
@Controller("documents")
@UseGuards(JwtAuthGuard)
@UseFilters(DocumentExceptionFilter)
export class DocumentController {
  constructor(
    private readonly uploads: DocumentUploadUseCases,
    private readonly retries: DocumentProcessingRetryUseCase,
    private readonly reprocess: DocumentReprocessUseCase,
  ) {}
  @Post(":id/reprocess")
  @HttpCode(202)
  @ApiHeader({
    name: "x-idempotency-key",
    schema: { type: "string", format: "uuid" },
    required: true,
    description:
      "UUID identifying this reprocess request; reuse it when retrying the same request",
  })
  reindex(
    @CurrentDocumentUser() user: string,
    @Param() dto: DocumentIdDto,
    @Headers("x-idempotency-key") key?: string,
  ) {
    return this.reprocess.execute(dto.id, user, key);
  }
  @Post(":id/retry-processing")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Schedule an owner-authorized retry for an eligible failed document",
  })
  retry(@CurrentDocumentUser() user: string, @Param() dto: DocumentIdDto) {
    return this.retries.execute(dto.id, user);
  }
  @Post("upload-url")
  @ApiBody({
    type: UploadDocumentDto,
    examples: {
      textFile: {
        summary: "UTF-8 file containing hello! (6 bytes)",
        value: { filename: "notes.txt", mimeType: "text/plain", sizeBytes: 6 },
      },
    },
  })
  @ApiOperation({
    summary: "Reserve a private upload and obtain presigned POST fields",
  })
  uploadUrl(
    @CurrentDocumentUser() user: string,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.uploads.uploadUrl(user, dto);
  }
  @Post(":id/upload-complete")
  @HttpCode(200)
  @ApiOperation({
    summary: "Verify uploaded bytes and commit their immutable version",
  })
  complete(@CurrentDocumentUser() user: string, @Param() dto: DocumentIdDto) {
    return this.uploads.complete(user, dto.id);
  }
  @Get() list(
    @CurrentDocumentUser() user: string,
    @Query() query: DocumentListDto,
  ) {
    return this.uploads.list(user, query.limit);
  }
  @Get(":id") get(
    @CurrentDocumentUser() user: string,
    @Param() dto: DocumentIdDto,
  ) {
    return this.uploads.get(user, dto.id);
  }
  @Get(":id/download-url") download(
    @CurrentDocumentUser() user: string,
    @Param() dto: DocumentIdDto,
  ) {
    return this.uploads.download(user, dto.id);
  }
  @Delete(":id") @HttpCode(204) delete(
    @CurrentDocumentUser() user: string,
    @Param() dto: DocumentIdDto,
  ) {
    return this.uploads.delete(user, dto.id);
  }
}
