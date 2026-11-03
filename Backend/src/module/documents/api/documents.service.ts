import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ROLE_FORBIDDEN_MESSAGE,
  ROLE_FORBIDDEN_STATUS,
} from '../../../common/constants/role.constants';
import type { SessionUser } from '../../auth/api/session/session.types';
import {
  DOCUMENT_NOT_FOUND_MESSAGE,
  DOCUMENT_NOT_FOUND_STATUS,
  DOCUMENT_PROJECT_NOT_FOUND_MESSAGE,
  DOCUMENT_PROJECT_NOT_FOUND_STATUS,
} from './constants/documents.constants';
import type { DownloadUrlResponseDto } from './dto/documents-responses.dto';
import type { Document } from './entities/document.entity';
import { DocumentFactory } from './factories/document.factory';
import type { ProjectScope } from './interfaces/document.interfaces';
import { DocumentsPolicy } from './policies/documents.policy';
import { DocumentsRepository } from './repositories/documents.repository';
import { DocumentsStorage } from './storage/documents.storage';
import type { UploadedFile } from './validation/file.validator';
import { validateUpload } from './validation/file.validator';

/** Local-driver content path (relative — frontend resolves vs API_BASE). */
const LOCAL_CONTENT_PATH = (projectId: string, documentId: string): string =>
  `/api/v1/projects/${projectId}/documents/${documentId}/download/content`;

/**
 * Orchestration for project documents. Routes carry Session → ActiveMember
 * guards and deliberately **no `@Roles`** (the matrix is role *and*
 * membership sensitive — same reasoning as tasks). Behind the guards this
 * service re-checks visibility (404) and the mutation matrix (403
 * `role_forbidden`) on fresh DB reads — defense in depth.
 *
 * Failure split (plan §1): invisible project → **404** (missing and
 * forbidden indistinguishable, no existence leak); visible-but-forbidden →
 * **403** `role_forbidden`.
 *
 * Delete removes the storage object **then** the row (hard delete, plan §2);
 * upload validates the file (§5) before anything touches storage.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly repository: DocumentsRepository,
    private readonly policy: DocumentsPolicy,
    private readonly factory: DocumentFactory,
    private readonly storage: DocumentsStorage,
  ) {}

  /** Newest-first list — invisible project → 404 (no existence leak). */
  async list(
    projectId: string,
    actor: SessionUser,
  ): Promise<{ documents: Document[] }> {
    await this.requireVisible(projectId, actor);
    return { documents: await this.repository.listByProject(projectId) };
  }

  /**
   * Upload: visibility → manage matrix → validate (size/ext/MIME/magic/
   * filename, plan §5) → build key → `StorageService.put` → insert row.
   * Storage is written **before** the row so a failed insert never leaves
   * an unreachable row (worst case: an orphan object, invisible to users).
   */
  async upload(
    projectId: string,
    file: UploadedFile,
    actor: SessionUser,
  ): Promise<Document> {
    const scope = await this.requireVisible(projectId, actor);
    this.requireManage(actor, scope);

    const validated = validateUpload(file);
    const objectKey = this.storage.buildObjectKey(
      scope.id,
      validated.extension,
    );
    await this.storage.put(objectKey, file.buffer, {
      contentType: validated.mimeType,
      contentLength: validated.sizeBytes,
    });

    const input = this.factory.create(validated, {
      projectId: scope.id,
      uploadedByUserId: actor.userId,
      objectKey,
    });
    return this.repository.create(input);
  }

  /**
   * Download contract (plan §4): 200 JSON `{ url, expiresInSeconds }` —
   * minio/s3 presign absolute URL + 300; `local` relative content path + 0.
   * Authz (`requireVisible`) runs before any URL is issued.
   */
  async download(
    projectId: string,
    documentId: string,
    actor: SessionUser,
  ): Promise<DownloadUrlResponseDto> {
    const { document } = await this.requireDocument(
      projectId,
      documentId,
      actor,
    );

    if (this.storage.driver === 'local') {
      return {
        url: LOCAL_CONTENT_PATH(projectId, documentId),
        expiresInSeconds: 0,
      };
    }

    const resolution = await this.storage.resolveDownload(
      document.objectKey,
      document.originalName,
      document.extension,
    );
    if (resolution.kind !== 'redirect') {
      // Unreachable: remote drivers never return a file resolution.
      throw new NotFoundException({
        status: DOCUMENT_NOT_FOUND_STATUS,
        message: DOCUMENT_NOT_FOUND_MESSAGE,
      });
    }
    return {
      url: resolution.url,
      expiresInSeconds: resolution.expiresInSeconds,
    };
  }

  /**
   * Streams the file — **local driver only** (else 404, plan §4). Re-runs
   * the guards + `requireVisible` on its own request; returns the material
   * the controller needs to set headers (disposition comes from the same
   * policy the presigned URLs use).
   */
  async downloadContent(
    projectId: string,
    documentId: string,
    actor: SessionUser,
  ): Promise<{ absolutePath: string; document: Document }> {
    const { document } = await this.requireDocument(
      projectId,
      documentId,
      actor,
    );
    if (this.storage.driver !== 'local') {
      throw new NotFoundException({
        status: DOCUMENT_NOT_FOUND_STATUS,
        message: DOCUMENT_NOT_FOUND_MESSAGE,
      });
    }
    const resolution = await this.storage.resolveDownload(
      document.objectKey,
      document.originalName,
      document.extension,
    );
    if (resolution.kind !== 'file') {
      throw new NotFoundException({
        status: DOCUMENT_NOT_FOUND_STATUS,
        message: DOCUMENT_NOT_FOUND_MESSAGE,
      });
    }
    return { absolutePath: resolution.absolutePath, document };
  }

  /**
   * Content-Disposition for the local content route — the exact value the
   * presigned URLs carry, so all three drivers serve identical semantics
   * (SVG ⇒ `attachment`, plan §5).
   */
  dispositionFor(document: Document): string {
    return this.storage.contentDisposition(
      document.originalName,
      document.extension,
    );
  }

  /**
   * Delete — manage matrix first; storage object removed **before** the
   * row so a failed unlink leaves the row intact (retryable), never the
   * reverse (a row pointing at nothing).
   */
  async remove(
    projectId: string,
    documentId: string,
    actor: SessionUser,
  ): Promise<void> {
    const { document, scope } = await this.requireDocument(
      projectId,
      documentId,
      actor,
    );
    this.requireManage(actor, scope);
    await this.storage.remove(document.objectKey);
    await this.repository.remove(document.id);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Project scope + visibility half of the matrix. Missing project and
   * invisible project are the same 404 (plan §1 — no existence leak).
   */
  private async requireVisible(
    projectId: string,
    actor: SessionUser,
  ): Promise<ProjectScope> {
    const scope = await this.repository.findProjectScope(
      projectId,
      actor.userId,
    );
    if (scope === null || !this.policy.canSee(actor.role, scope.isMember)) {
      throw this.projectNotFound();
    }
    return scope;
  }

  /**
   * Document + its project scope, both visibility-checked: a missing
   * document, a document from another project, *and* an invisible project
   * all answer `document_not_found` on document routes (same deliberate
   * indistinguishability as tasks). Callers gate mutations with
   * `requireManage(scope)` — download/list only need the visibility half.
   */
  private async requireDocument(
    projectId: string,
    documentId: string,
    actor: SessionUser,
  ): Promise<{ document: Document; scope: ProjectScope }> {
    const document = await this.repository.findById(documentId);
    if (document === null || document.projectId !== projectId) {
      throw this.documentNotFound();
    }
    const scope = await this.requireVisible(document.projectId, actor);
    return { document, scope };
  }

  /** Mutation half of the matrix — visible but not allowed → 403. */
  private requireManage(actor: SessionUser, scope: ProjectScope): void {
    const allowed = this.policy.canManage({
      role: actor.role,
      isMember: scope.isMember,
      isLead: scope.isLead,
    });
    if (!allowed) throw this.roleForbidden();
  }

  private roleForbidden(): ForbiddenException {
    return new ForbiddenException({
      status: ROLE_FORBIDDEN_STATUS,
      message: ROLE_FORBIDDEN_MESSAGE,
    });
  }

  private projectNotFound(): NotFoundException {
    return new NotFoundException({
      status: DOCUMENT_PROJECT_NOT_FOUND_STATUS,
      message: DOCUMENT_PROJECT_NOT_FOUND_MESSAGE,
    });
  }

  private documentNotFound(): NotFoundException {
    return new NotFoundException({
      status: DOCUMENT_NOT_FOUND_STATUS,
      message: DOCUMENT_NOT_FOUND_MESSAGE,
    });
  }
}
