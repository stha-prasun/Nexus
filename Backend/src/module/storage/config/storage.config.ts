import * as path from 'node:path';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import {
  DEFAULT_PRESIGN_TTL_SECONDS,
  DEFAULT_STORAGE_BUCKET,
  DEFAULT_STORAGE_DRIVER,
  DEFAULT_STORAGE_LOCAL_DIR,
  type StorageDriver,
} from '../constants/storage.constants';

export interface StorageConfig {
  driver: StorageDriver;
  /** Remote drivers only. */
  bucket: string;
  presignTtlSeconds: number;
  /** Remote drivers only — endpoint, region, forcePathStyle, credentials. */
  clientOptions?: S3ClientConfig;
  /** Local driver only — absolute path of the uploads root. */
  localDirAbs?: string;
}

type Env = Record<string, string | undefined>;

const DRIVERS: readonly StorageDriver[] = ['minio', 's3', 'local'];

const fail = (message: string): never => {
  throw new Error(`[storage] ${message}`);
};

const parseEndpoint = (raw: string, label: string): URL => {
  // A bare host (no scheme) implies https.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return fail(`malformed ${label}: "${raw}"`);
  }
  if (!url.hostname) return fail(`malformed ${label}: "${raw}"`);
  return url;
};

const positiveInt = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return fail(`expected a positive integer, got "${raw}"`);
  }
  return value;
};

const minioClientOptions = (env: Env): S3ClientConfig => {
  const host = env.MINIO_ENDPOINT ?? 'localhost';
  const port = env.MINIO_API_PORT ?? '9000';
  const useSsl = (env.MINIO_USE_SSL ?? 'false') === 'true';
  const url = parseEndpoint(
    `${useSsl ? 'https' : 'http'}://${host}:${port}`,
    'MINIO endpoint',
  );
  return {
    endpoint: url.origin,
    forcePathStyle: true,
    region: env.MINIO_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: env.MINIO_ROOT_USER ?? 'nexus',
      secretAccessKey: env.MINIO_ROOT_PASSWORD ?? 'nexus_minio_password',
    },
  };
};

const s3ClientOptions = (env: Env): S3ClientConfig => {
  const options: S3ClientConfig = {
    region: env.S3_REGION ?? 'us-east-1',
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
  };
  const endpoint = env.S3_ENDPOINT?.trim();
  if (endpoint) {
    options.endpoint = parseEndpoint(endpoint, 'S3_ENDPOINT').origin;
  }
  // Empty keys ⇒ undefined credentials ⇒ SDK default chain
  // (env → shared profile → IMDS; IAM roles work in prod).
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  if (accessKeyId) {
    options.credentials = {
      accessKeyId,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    };
  }
  return options;
};

/** Pure env resolver — fail-fast on typos, never silent fallbacks. */
export const resolveStorageConfig = (env: Env): StorageConfig => {
  const rawDriver = env.STORAGE_DRIVER?.trim() || DEFAULT_STORAGE_DRIVER;
  if (!DRIVERS.includes(rawDriver as StorageDriver)) {
    return fail(
      `STORAGE_DRIVER must be one of ${DRIVERS.join(', ')}, got "${rawDriver}"`,
    );
  }
  const driver = rawDriver as StorageDriver;
  const presignTtlSeconds = positiveInt(
    env.STORAGE_PRESIGN_TTL_SECONDS,
    DEFAULT_PRESIGN_TTL_SECONDS,
  );

  if (driver === 'local') {
    const localDir =
      env.STORAGE_LOCAL_DIR === undefined
        ? DEFAULT_STORAGE_LOCAL_DIR
        : env.STORAGE_LOCAL_DIR.trim();
    if (!localDir) return fail('STORAGE_LOCAL_DIR must not be empty');
    return {
      driver,
      bucket: '',
      presignTtlSeconds,
      localDirAbs: path.resolve(process.cwd(), localDir),
    };
  }

  const bucket =
    env.STORAGE_BUCKET === undefined
      ? DEFAULT_STORAGE_BUCKET
      : env.STORAGE_BUCKET.trim();
  if (!bucket) return fail('STORAGE_BUCKET must not be empty');

  return {
    driver,
    bucket,
    presignTtlSeconds,
    clientOptions:
      driver === 'minio' ? minioClientOptions(env) : s3ClientOptions(env),
  };
};
