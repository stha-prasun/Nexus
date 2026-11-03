import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AllowedExtension } from '../constants/documents.constants';

/** A fully-validated upload — output of `file.validator.ts`. */
export interface ValidatedFile {
  /** Sanitized display name (plan §5 step 5). */
  originalName: string;
  mimeType: string;
  extension: AllowedExtension;
  sizeBytes: number;
}

/** Row material handed to the repository's insert. */
export interface DocumentCreateInput {
  id: string;
  projectId: string;
  uploadedByUserId: string;
  originalName: string;
  /** Built by `documents.storage.ts` — random UUID, never the client name. */
  objectKey: string;
  mimeType: string;
  extension: AllowedExtension;
  sizeBytes: number;
  createdAt: Date;
}

/**
 * The single construction point for `Document` rows. The object key is
 * supplied already built (documents' storage wrapper owns the
 * `projects/<projectId>/<uuidv4>.<ext>` scheme) — this factory only stamps
 * the row id and `createdAt`, so repository and factory can never disagree
 * about which parts of the row are derived where (plan §2, §3).
 */
@Injectable()
export class DocumentFactory {
  create(
    file: ValidatedFile,
    context: {
      projectId: string;
      uploadedByUserId: string;
      objectKey: string;
    },
  ): DocumentCreateInput {
    return {
      id: randomUUID(),
      projectId: context.projectId,
      uploadedByUserId: context.uploadedByUserId,
      originalName: file.originalName,
      objectKey: context.objectKey,
      mimeType: file.mimeType,
      extension: file.extension,
      sizeBytes: file.sizeBytes,
      createdAt: new Date(),
    };
  }
}
