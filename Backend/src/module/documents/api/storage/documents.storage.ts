import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type DownloadResolution,
  StorageService,
} from '../../../storage/storage.service';
import type { AllowedExtension } from '../constants/documents.constants';

/**
 * RFC 5987 `filename*` value — keeps unicode/space names intact inside a
 * quoted `filename` pair without breaking the header grammar.
 */
const encodeDispositionFilename = (name: string): string =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * Document-specific storage policy: the object-key scheme and the
 * Content-Disposition rules. I/O itself is delegated to the generic
 * `StorageService` (storage-plan.md §3) — this wrapper is the only place
 * that knows how documents are laid out in the bucket/uploads dir.
 *
 * - Key: `projects/<projectId>/<uuidv4>.<ext>` — the original filename
 *   **never** touches the storage path (same scheme for all three drivers).
 * - SVG always downloads as `attachment` (no inline script execution,
 *   plan §1/§5); everything else is `inline` with the sanitized original
 *   name RFC 5987-encoded.
 */
@Injectable()
export class DocumentsStorage {
  constructor(private readonly storage: StorageService) {}

  get driver(): StorageService['driver'] {
    return this.storage.driver;
  }

  /** Random key under the project prefix — client name is never used. */
  buildObjectKey(projectId: string, extension: AllowedExtension): string {
    return `projects/${projectId}/${randomUUID()}.${extension}`;
  }

  /**
   * Disposition header value — one policy for the presigned
   * `ResponseContentDisposition` (remote) and the local content route's
   * response header, so both drivers serve identical semantics.
   */
  contentDisposition(
    originalName: string,
    extension: AllowedExtension,
  ): string {
    const encoded = encodeDispositionFilename(originalName);
    const kind = extension === 'svg' ? 'attachment' : 'inline';
    return `${kind}; filename="${encoded}"; filename*=UTF-8''${encoded}`;
  }

  put(
    key: string,
    body: Buffer,
    opts: { contentType: string; contentLength: number },
  ): Promise<void> {
    return this.storage.put(key, body, opts);
  }

  resolveDownload(
    key: string,
    originalName: string,
    extension: AllowedExtension,
  ): Promise<DownloadResolution> {
    return this.storage.resolveDownload(
      key,
      this.contentDisposition(originalName, extension),
    );
  }

  remove(key: string): Promise<void> {
    return this.storage.remove(key);
  }
}
