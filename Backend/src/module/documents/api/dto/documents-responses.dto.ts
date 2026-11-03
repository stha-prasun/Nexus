import { ApiProperty } from '@nestjs/swagger';
import { ALLOWED_EXTENSIONS } from '../constants/documents.constants';
import type { Document } from '../entities/document.entity';

export class DocumentUploaderResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000031' })
  id!: string;

  @ApiProperty({ example: 'Maya' })
  name!: string;
}

export class DocumentResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000051' })
  id!: string;

  @ApiProperty({ example: 'Project brief.pdf', maxLength: 200 })
  name!: string;

  @ApiProperty({ example: 1_258_291, description: 'Size in bytes.' })
  size!: number;

  @ApiProperty({ enum: [...ALLOWED_EXTENSIONS], example: 'pdf' })
  extension!: (typeof ALLOWED_EXTENSIONS)[number];

  @ApiProperty({ type: DocumentUploaderResponseDto })
  uploadedBy!: DocumentUploaderResponseDto;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;
}

export class ListDocumentsResponseDto {
  @ApiProperty({ type: [DocumentResponseDto] })
  documents!: DocumentResponseDto[];
}

/** POST upload wrapper — `{ document }` (plan §4). */
export class GetDocumentResponseDto {
  @ApiProperty({ type: DocumentResponseDto })
  document!: DocumentResponseDto;
}

/**
 * Download contract for **all three drivers** (plan §4): remote → absolute
 * presigned URL + `expiresInSeconds = 300`; `local` → relative
 * `.../download/content` path + `0` (frontend resolves against API_BASE).
 */
export class DownloadUrlResponseDto {
  @ApiProperty({
    example:
      'http://localhost:9000/nexus-documents/projects/…/file.pdf?X-Amz-…',
    description:
      'Absolute presigned URL (minio/s3) or relative /download/content path (local).',
  })
  url!: string;

  @ApiProperty({
    example: 300,
    description: 'Presign TTL — 0 for the local driver (no expiry).',
  })
  expiresInSeconds!: number;
}

/** DELETE wrapper — mirrors `TaskMessageResponseDto`. */
export class DocumentMessageResponseDto {
  @ApiProperty({ example: 'Document deleted successfully.' })
  message!: string;

  @ApiProperty({ example: 1 })
  deleted!: number;
}

/** Serialization seam — repository entities never leave the API directly. */
export const toDocumentResponse = (
  document: Document,
): DocumentResponseDto => ({
  id: document.id,
  name: document.originalName,
  size: document.sizeBytes,
  extension: document.extension,
  uploadedBy: {
    id: document.uploader.id,
    name: document.uploader.name,
  },
  createdAt: document.createdAt,
});
