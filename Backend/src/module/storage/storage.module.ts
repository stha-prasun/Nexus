import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { resolveStorageConfig } from './config/storage.config';
import { STORAGE_CLIENT } from './constants/storage.constants';
import { StorageService } from './storage.service';

// Defaults mirror Backend/.env (and docker-compose.yml), so `docker compose
// up -d` + `npm start` works even without a .env file present — the same
// convention redis.module.ts and health.module.ts already use.
const storageClientProvider = {
  provide: STORAGE_CLIENT,
  useFactory: (): S3Client | null => {
    const config = resolveStorageConfig(process.env);
    // The local driver needs no SDK client — StorageService never touches
    // STORAGE_CLIENT on that path.
    if (config.driver === 'local') return null;
    return new S3Client(config.clientOptions ?? {});
  },
};

/**
 * Object storage leaf module (MinIO / any S3 / server disk) — mirrors
 * RedisModule: factory + token + service, explicit imports.
 *
 * Dependency direction: `StorageModule → nothing` (leaf). Consumers:
 * HealthModule, DocumentsModule, AppModule (boot-time ensureBucket/mkdir
 * runs via StorageService.onModuleInit). Document-specific policy (object
 * keys, disposition) lives in the documents module's `api/storage/`.
 */
@Module({
  providers: [storageClientProvider, StorageService],
  exports: [StorageService, STORAGE_CLIENT],
})
export class StorageModule {}
