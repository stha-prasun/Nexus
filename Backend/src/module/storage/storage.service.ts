import { constants as fsConstants } from 'node:fs';
import { access, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { TracingService } from '../../common/tracing/tracing.service';
import {
  resolveStorageConfig,
  type StorageConfig,
} from './config/storage.config';
import {
  DOCUMENT_FILE_MISSING_MESSAGE,
  DOCUMENT_FILE_MISSING_STATUS,
  STORAGE_CLIENT,
  type StorageDriver,
} from './constants/storage.constants';

export type DownloadResolution =
  | { kind: 'redirect'; url: string; expiresInSeconds: number }
  | { kind: 'file'; absolutePath: string };

/**
 * Driver-agnostic object I/O. Remote drivers (minio/s3) presign and talk to
 * S3 through a span-wrapped `send()`; the local driver reads/writes files
 * under `STORAGE_LOCAL_DIR` with a path-traversal guard. `/uploads` is never
 * served statically — only the guarded documents content route streams
 * local files (storage-plan.md §5).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly config: StorageConfig;

  constructor(
    @Inject(STORAGE_CLIENT) private readonly client: S3Client | null,
    private readonly tracing: TracingService,
  ) {
    this.config = resolveStorageConfig(process.env);
  }

  get driver(): StorageDriver {
    return this.config.driver;
  }

  async onModuleInit(): Promise<void> {
    if (this.config.driver === 'local') {
      await mkdir(this.config.localDirAbs as string, { recursive: true });
      return;
    }
    try {
      await this.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
        `HEAD ${this.config.bucket}`,
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
      try {
        await this.send(
          new CreateBucketCommand({ Bucket: this.config.bucket }),
          `CREATE ${this.config.bucket}`,
        );
      } catch (createError) {
        // A concurrent boot may have created it already.
        if (!isAlreadyOwned(createError)) throw createError;
      }
    }
  }

  async put(
    key: string,
    body: Buffer,
    opts: { contentType: string; contentLength: number },
  ): Promise<void> {
    if (this.config.driver === 'local') {
      const absolutePath = this.localPath(key);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, body);
      return;
    }
    await this.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength,
      }),
      `PUT ${key}`,
    );
  }

  async resolveDownload(
    key: string,
    contentDisposition: string,
  ): Promise<DownloadResolution> {
    if (this.config.driver === 'local') {
      const absolutePath = this.localPath(key);
      try {
        await stat(absolutePath);
      } catch (error) {
        if (isNotFound(error)) {
          throw new NotFoundException({
            status: DOCUMENT_FILE_MISSING_STATUS,
            message: DOCUMENT_FILE_MISSING_MESSAGE,
          });
        }
        throw error;
      }
      return { kind: 'file', absolutePath };
    }
    // Local signing — no network, no span.
    const url = await getSignedUrl(
      this.client as S3Client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition,
      }),
      { expiresIn: this.config.presignTtlSeconds },
    );
    return {
      kind: 'redirect',
      url,
      expiresInSeconds: this.config.presignTtlSeconds,
    };
  }

  async remove(key: string): Promise<void> {
    if (this.config.driver === 'local') {
      try {
        await unlink(this.localPath(key));
      } catch (error) {
        if (!isNotFound(error)) throw error; // idempotent
      }
      return;
    }
    await this.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      `DELETE ${key}`,
    );
  }

  async probe(): Promise<void> {
    if (this.config.driver === 'local') {
      await access(this.config.localDirAbs as string, fsConstants.W_OK);
      return;
    }
    await this.send(new ListBucketsCommand({}), 'LIST buckets');
  }

  /**
   * Network commands run inside a `minio` span (system name kept for
   * metrics/tracing contracts — it means object storage). The local driver
   * produces no spans (fs ops are fast).
   */
  private send<T>(
    command: Parameters<S3Client['send']>[0],
    label: string,
  ): Promise<T> {
    const handle = this.tracing.begin('minio', label);
    const result = handle.run(() =>
      (this.client as S3Client).send(command),
    ) as Promise<T>;
    return result.then(
      (value) => {
        handle.end();
        return value;
      },
      (error: unknown) => {
        handle.end(error);
        throw error;
      },
    );
  }

  /**
   * Object keys come from the DB but are never trusted — the resolved path
   * MUST stay under the uploads root (traversal guard).
   */
  private localPath(key: string): string {
    const root = path.resolve(this.config.localDirAbs as string);
    const absolutePath = path.resolve(root, key);
    const relative = path.relative(root, absolutePath);
    if (
      relative === '' ||
      relative.startsWith('..') ||
      path.isAbsolute(relative)
    ) {
      throw new BadRequestException({
        status: 'invalid_object_key',
        message: 'Invalid storage key.',
      });
    }
    return absolutePath;
  }
}

const isNotFound = (error: unknown): boolean =>
  hasStatusCode(error, 404) ||
  errorCode(error) === 'ENOENT' ||
  errorName(error) === 'NotFound' ||
  errorName(error) === 'NoSuchKey';

const isAlreadyOwned = (error: unknown): boolean =>
  errorName(error) === 'BucketAlreadyOwnedByYou' ||
  errorName(error) === 'BucketAlreadyExists';

const errorName = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : undefined;

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

const hasStatusCode = (error: unknown, code: number): boolean =>
  typeof error === 'object' &&
  error !== null &&
  '$metadata' in error &&
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode === code;
