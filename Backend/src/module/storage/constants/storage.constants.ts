export const STORAGE_CLIENT = 'STORAGE_CLIENT';

export type StorageDriver = 'minio' | 's3' | 'local';

// Defaults mirror Backend/.env (and docker-compose.yml), so `docker compose
// up -d` + `npm start` works even without a .env file present.
export const DEFAULT_STORAGE_DRIVER: StorageDriver = 'minio';
export const DEFAULT_STORAGE_BUCKET = 'nexus-documents';
export const DEFAULT_PRESIGN_TTL_SECONDS = 300;
export const DEFAULT_STORAGE_LOCAL_DIR = 'uploads';

/** 404 — local file for the object key is missing on disk. */
export const DOCUMENT_FILE_MISSING_STATUS = 'document_file_missing';
export const DOCUMENT_FILE_MISSING_MESSAGE = 'Document file not found.';
