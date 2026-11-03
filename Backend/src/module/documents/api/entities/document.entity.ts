import type { AllowedExtension } from '../constants/documents.constants';

/** Uploader summary rendered in the list — resolved via a users join. */
export interface DocumentUploaderSummary {
  id: string;
  name: string;
}

export interface DocumentProps {
  id: string;
  projectId: string;
  uploadedByUserId: string;
  /** Sanitized display name — the storage path never sees it (plan §2). */
  originalName: string;
  /** Storage key `projects/<projectId>/<uuidv4>.<ext>` — unique. */
  objectKey: string;
  mimeType: string;
  extension: AllowedExtension;
  /** bigint in Postgres — a plain number here (≤ 25 MB by construction). */
  sizeBytes: number;
  uploader: DocumentUploaderSummary;
  createdAt: Date;
}

/**
 * Domain entity for one `documents` row — immutable (no `updated_at`, no
 * update endpoint, plan §2). The uploader summary rides along so the list
 * renders without a second fetch. Never serialized directly: controllers
 * map through `DocumentResponseDto`.
 */
export class Document {
  constructor(private readonly props: DocumentProps) {}

  get id(): string {
    return this.props.id;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get uploadedByUserId(): string {
    return this.props.uploadedByUserId;
  }

  get originalName(): string {
    return this.props.originalName;
  }

  get objectKey(): string {
    return this.props.objectKey;
  }

  get mimeType(): string {
    return this.props.mimeType;
  }

  get extension(): AllowedExtension {
    return this.props.extension;
  }

  get sizeBytes(): number {
    return this.props.sizeBytes;
  }

  get uploader(): DocumentUploaderSummary {
    return this.props.uploader;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
