import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { UnauthenticatedResponseDto } from '../../auth/api/dto/auth-responses.dto';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { ActiveMemberGuard } from '../../members/api/guards/active-member.guard';
import {
  FILE_REQUIRED_MESSAGE,
  FILE_REQUIRED_STATUS,
  MAX_FILE_BYTES,
} from './constants/documents.constants';
import { DocumentsService } from './documents.service';
import {
  DocumentMessageResponseDto,
  DownloadUrlResponseDto,
  GetDocumentResponseDto,
  ListDocumentsResponseDto,
  toDocumentResponse,
} from './dto/documents-responses.dto';
import { MulterExceptionFilter } from './validation/multer-exception.filter';

/** Error-body examples for Swagger — mirrors the tasks controller. */
const example = (status: string, message: string) => ({
  schema: { example: { status, message } },
});

const ROLE_FORBIDDEN_EXAMPLE = example(
  'role_forbidden',
  'Your role is not allowed to perform this action.',
);

const NOT_ACTIVE_MEMBER_EXAMPLE = example(
  'not_active_member',
  'You are not an active member of this organization.',
);

/**
 * One intake for every driver (storage-plan.md §5): multer buffers the
 * multipart body in RAM; `limits.fileSize` is the first size gate (the
 * service re-checks after — defense in depth), `files: 1` rejects extra
 * files with `LIMIT_FILE_COUNT`. Exported for the controller spec —
 * `FileInterceptor` builds a fresh class per call, so the options object
 * is the assertable seam.
 */
export const uploadInterceptorOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
};

const uploadInterceptor = FileInterceptor('file', uploadInterceptorOptions);

@ApiTags('Documents')
@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('projects/:projectId/documents')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'List project documents, newest first — Admin/HR any project, PM/Dev members only; invisible project 404 (no @Roles: matrix is role+membership sensitive)',
  })
  @ApiOkResponse({ type: ListDocumentsResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "document_project_not_found", message }',
    ...example('document_project_not_found', 'Project not found.'),
  })
  @ApiForbiddenResponse({
    description: '403 { status: "not_active_member", message }',
    ...NOT_ACTIVE_MEMBER_EXAMPLE,
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ListDocumentsResponseDto> {
    const { documents } = await this.documentsService.list(projectId, req.user);
    return { documents: documents.map(toDocumentResponse) };
  }

  @Post('projects/:projectId/documents')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @UseInterceptors(uploadInterceptor)
  // Maps multer's own limit errors (thrown in the interceptor, before the
  // handler) onto the repo's `{ status, message }` vocabulary — plan §5.
  @UseFilters(MulterExceptionFilter)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Upload one file (multipart field `file`) — Admin any project, PM/Lead members only; HR/plain Dev 403, invisible project 404; 25 MB + ext/MIME/magic-byte validation',
  })
  @ApiCreatedResponse({ type: GetDocumentResponseDto })
  @ApiBadRequestResponse({
    description:
      '400 { status: "file_empty" | "file_required", message } — zero-byte file or missing multipart field',
    ...example('file_empty', 'The uploaded file is empty.'),
  })
  @ApiPayloadTooLargeResponse({
    description: '413 { status: "file_too_large", message }',
    ...example('file_too_large', 'The file exceeds the 25 MB limit.'),
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      '415 { status: "file_extension_not_allowed" | "file_mime_not_allowed" | "file_content_mismatch", message }',
    ...example(
      'file_content_mismatch',
      'The file content does not match its extension.',
    ),
  })
  @ApiNotFoundResponse({
    description: '404 { status: "document_project_not_found", message }',
    ...example('document_project_not_found', 'Project not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden" | "not_active_member", message }',
    ...ROLE_FORBIDDEN_EXAMPLE,
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async upload(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetDocumentResponseDto> {
    const file = req.file;
    if (file === undefined) {
      throw new BadRequestException({
        status: FILE_REQUIRED_STATUS,
        message: FILE_REQUIRED_MESSAGE,
      });
    }
    const document = await this.documentsService.upload(
      projectId,
      file,
      req.user,
    );
    return { document: toDocumentResponse(document) };
  }

  @Get('projects/:projectId/documents/:documentId/download')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'Download ticket — 200 { url, expiresInSeconds }: absolute presigned URL + 300 (minio/s3), relative /download/content path + 0 (local); viewers only (Admin/HR any project, PM/Dev members)',
  })
  @ApiOkResponse({ type: DownloadUrlResponseDto })
  @ApiNotFoundResponse({
    description:
      '404 { status: "document_not_found" | "document_project_not_found", message }',
    ...example('document_not_found', 'Document not found.'),
  })
  @ApiForbiddenResponse({
    description: '403 { status: "not_active_member", message }',
    ...NOT_ACTIVE_MEMBER_EXAMPLE,
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async download(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<DownloadUrlResponseDto> {
    return this.documentsService.download(projectId, documentId, req.user);
  }

  @Get('projects/:projectId/documents/:documentId/download/content')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'Stream the file bytes — LOCAL driver only (minio/s3 → 404); fully guarded like every route; missing file on disk → 404 document_file_missing; SVG forced to attachment',
  })
  @ApiOkResponse({
    description: '200 — raw file stream (Content-Type from the DB row).',
  })
  @ApiNotFoundResponse({
    description:
      '404 { status: "document_not_found" | "document_file_missing" | "document_project_not_found", message }',
    ...example('document_file_missing', 'Document file not found.'),
  })
  @ApiForbiddenResponse({
    description: '403 { status: "not_active_member", message }',
    ...NOT_ACTIVE_MEMBER_EXAMPLE,
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async downloadContent(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: AuthenticatedRequest,
    // Not passthrough: sendFile ends the response itself — Nest must not
    // also serialize a return value over an already-streamed body.
    @Res() res: Response,
  ): Promise<void> {
    const { absolutePath, document } =
      await this.documentsService.downloadContent(
        projectId,
        documentId,
        req.user,
      );
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader(
      'Content-Disposition',
      this.documentsService.dispositionFor(document),
    );
    res.setHeader('Content-Length', String(document.sizeBytes));
    res.sendFile(absolutePath);
  }

  @Delete('projects/:projectId/documents/:documentId')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete a document — storage object first, then the row; Admin any project, PM/Lead members only; HR/plain Dev 403, invisible project/document 404',
  })
  @ApiOkResponse({ type: DocumentMessageResponseDto })
  @ApiNotFoundResponse({
    description:
      '404 { status: "document_not_found" | "document_project_not_found", message }',
    ...example('document_not_found', 'Document not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden" | "not_active_member", message }',
    ...ROLE_FORBIDDEN_EXAMPLE,
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async remove(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<DocumentMessageResponseDto> {
    await this.documentsService.remove(projectId, documentId, req.user);
    return { message: 'Document deleted successfully.', deleted: 1 };
  }
}
