import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/api/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { StorageModule } from '../../storage/storage.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentFactory } from './factories/document.factory';
import { DocumentsPolicy } from './policies/documents.policy';
import { DocumentsRepository } from './repositories/documents.repository';
import { DocumentsStorage } from './storage/documents.storage';

/**
 * Project document uploads — Admin/PM/Lead upload and delete, everyone who
 * can see the project views/downloads (plan §1). Files live in MinIO/S3/`/uploads`
 * behind `StorageService`; metadata in Postgres (`documents` table).
 *
 * One-way dependencies (documented like TasksModule):
 * `DocumentsModule → DatabaseModule, AuthModule, StorageModule` — nothing
 * imports DocumentsModule except `AppModule`. No cycle: StorageModule is a
 * leaf (storage-plan.md §3).
 */
@Module({
  imports: [AuthModule, DatabaseModule, StorageModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentsRepository,
    DocumentsPolicy,
    DocumentFactory,
    DocumentsStorage,
  ],
})
export class DocumentsModule {}
