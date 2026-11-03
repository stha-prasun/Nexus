import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import {
  documents,
  projectMembers,
  projects,
  users,
} from '../../../database/schema';
import type { AllowedExtension } from '../constants/documents.constants';
import {
  Document,
  type DocumentUploaderSummary,
} from '../entities/document.entity';
import type { DocumentCreateInput } from '../factories/document.factory';
import type {
  DocumentRow,
  ProjectScope,
} from '../interfaces/document.interfaces';

export type { ProjectScope } from '../interfaces/document.interfaces';

const uploaders = alias(users, 'document_uploaders');

const documentSelect = {
  id: documents.id,
  projectId: documents.projectId,
  uploadedByUserId: documents.uploadedByUserId,
  originalName: documents.originalName,
  objectKey: documents.objectKey,
  mimeType: documents.mimeType,
  extension: documents.extension,
  sizeBytes: documents.sizeBytes,
  createdAt: documents.createdAt,
  uploaderName: uploaders.name,
};

/**
 * Drizzle persistence for documents — immutable rows (no update method by
 * construction, plan §2). Two responsibilities beyond CRUD:
 *
 * 1. **Project scope read** for the visibility matrix: the project row plus
 *    the actor's `project_members` flags — the same shape tasks uses, so
 *    `requireVisible` behaves identically (404 for non-members).
 * 2. **Hydrated list/find**: the uploader summary rides a LEFT JOIN on
 *    users, newest-first ordering, no second fetch.
 */
@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Project name + actor's membership flags — visibility for every route. */
  async findProjectScope(
    projectId: string,
    actorUserId: string,
  ): Promise<ProjectScope | null> {
    const rows = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const project = rows[0];
    if (project === undefined) return null;
    const memberships = await this.db
      .select({ isLead: projectMembers.isLead })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, actorUserId),
        ),
      )
      .limit(1);
    const membership = memberships[0];
    return {
      id: project.id,
      name: project.name,
      isMember: membership !== undefined,
      isLead: membership?.isLead ?? false,
    };
  }

  /** Every document of a project, newest first, uploader resolved. */
  async listByProject(projectId: string): Promise<Document[]> {
    const rows = (await this.db
      .select(documentSelect)
      .from(documents)
      .leftJoin(uploaders, eq(documents.uploadedByUserId, uploaders.id))
      .where(eq(documents.projectId, projectId))
      .orderBy(desc(documents.createdAt))) as DocumentRow[];
    return rows.map(toDocument);
  }

  /** One document by id, or null (missing and invisible both stay 404). */
  async findById(documentId: string): Promise<Document | null> {
    const rows = (await this.db
      .select(documentSelect)
      .from(documents)
      .leftJoin(uploaders, eq(documents.uploadedByUserId, uploaders.id))
      .where(eq(documents.id, documentId))
      .limit(1)) as DocumentRow[];
    const row = rows[0];
    return row === undefined ? null : toDocument(row);
  }

  /** Insert the immutable row (storage object is written by the service). */
  async create(input: DocumentCreateInput): Promise<Document> {
    const inserted = await this.db
      .insert(documents)
      .values({
        id: input.id,
        projectId: input.projectId,
        uploadedByUserId: input.uploadedByUserId,
        originalName: input.originalName,
        objectKey: input.objectKey,
        mimeType: input.mimeType,
        extension: input.extension,
        sizeBytes: input.sizeBytes,
        createdAt: input.createdAt,
      })
      .returning({ id: documents.id });
    const documentId = inserted[0]?.id;
    if (documentId === undefined) {
      throw new Error('document insert returned no id');
    }
    const document = await this.findById(documentId);
    if (document === null) {
      throw new Error(`document ${documentId} vanished after insert`);
    }
    return document;
  }

  /** Hard delete — the service removes the storage object first. */
  async remove(documentId: string): Promise<void> {
    await this.db.delete(documents).where(eq(documents.id, documentId));
  }
}

// ------------------------------------------------------------------ helpers

const toDocument = (row: DocumentRow): Document => {
  const uploader: DocumentUploaderSummary = {
    id: row.uploadedByUserId,
    name: row.uploaderName ?? 'Unknown',
  };
  return new Document({
    id: row.id,
    projectId: row.projectId,
    uploadedByUserId: row.uploadedByUserId,
    originalName: row.originalName,
    objectKey: row.objectKey,
    mimeType: row.mimeType,
    extension: row.extension as AllowedExtension,
    sizeBytes: Number(row.sizeBytes),
    uploader,
    createdAt: row.createdAt,
  });
};
