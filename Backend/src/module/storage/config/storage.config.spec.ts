import { resolveStorageConfig } from './storage.config';

describe('resolveStorageConfig', () => {
  const baseEnv = {
    STORAGE_DRIVER: 'minio',
    STORAGE_BUCKET: 'nexus-documents',
    MINIO_ENDPOINT: 'localhost',
    MINIO_API_PORT: '9000',
    MINIO_ROOT_USER: 'nexus',
    MINIO_ROOT_PASSWORD: 'nexus_minio_password',
  };

  it('builds minio defaults matching docker-compose', () => {
    const config = resolveStorageConfig(baseEnv);

    expect(config.driver).toBe('minio');
    expect(config.bucket).toBe('nexus-documents');
    expect(config.presignTtlSeconds).toBe(300);
    expect(config.localDirAbs).toBeUndefined();
    expect(config.clientOptions).toMatchObject({
      forcePathStyle: true,
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'nexus',
        secretAccessKey: 'nexus_minio_password',
      },
    });
    expect(config.clientOptions?.endpoint).toBe('http://localhost:9000');
  });

  it('honors MINIO_USE_SSL and MINIO_REGION', () => {
    const config = resolveStorageConfig({
      ...baseEnv,
      MINIO_USE_SSL: 'true',
      MINIO_REGION: 'eu-west-1',
    });

    expect(config.clientOptions?.endpoint).toBe('https://localhost:9000');
    expect(config.clientOptions?.region).toBe('eu-west-1');
  });

  it('uses the S3 SDK default endpoint when S3_ENDPOINT is empty', () => {
    const config = resolveStorageConfig({
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'bucket',
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: 'false',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
    });

    expect(config.clientOptions).toEqual({
      region: 'us-east-1',
      forcePathStyle: false,
    });
  });

  it('parses a full S3_ENDPOINT URL', () => {
    const config = resolveStorageConfig({
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'bucket',
      S3_ENDPOINT: 'https://s3.amazonaws.com',
    });

    expect(config.clientOptions?.endpoint).toBe('https://s3.amazonaws.com');
    expect(config.clientOptions?.forcePathStyle).toBe(true);
  });

  it('implies https for a bare S3 host', () => {
    const config = resolveStorageConfig({
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'bucket',
      S3_ENDPOINT: 'objects.example.com',
    });

    expect(config.clientOptions?.endpoint).toBe('https://objects.example.com');
  });

  it('keeps explicit S3 credentials when set', () => {
    const config = resolveStorageConfig({
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'bucket',
      S3_ACCESS_KEY_ID: 'ak',
      S3_SECRET_ACCESS_KEY: 'sk',
    });

    expect(config.clientOptions?.credentials).toEqual({
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
    });
  });

  it('leaves credentials undefined for the SDK default chain', () => {
    const config = resolveStorageConfig({
      STORAGE_DRIVER: 's3',
      STORAGE_BUCKET: 'bucket',
    });

    expect(config.clientOptions?.credentials).toBeUndefined();
  });

  it('throws on an invalid STORAGE_DRIVER', () => {
    expect(() =>
      resolveStorageConfig({ ...baseEnv, STORAGE_DRIVER: 'gcs' }),
    ).toThrow(/STORAGE_DRIVER/);
  });

  it('throws on a malformed S3_ENDPOINT', () => {
    expect(() =>
      resolveStorageConfig({
        STORAGE_DRIVER: 's3',
        STORAGE_BUCKET: 'bucket',
        S3_ENDPOINT: 'http://',
      }),
    ).toThrow(/S3_ENDPOINT/);
  });

  it('throws when STORAGE_BUCKET is empty for remote drivers', () => {
    expect(() =>
      resolveStorageConfig({ ...baseEnv, STORAGE_BUCKET: '  ' }),
    ).toThrow(/STORAGE_BUCKET/);
  });

  it('throws when STORAGE_LOCAL_DIR is empty for the local driver', () => {
    expect(() =>
      resolveStorageConfig({
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_DIR: '',
      }),
    ).toThrow(/STORAGE_LOCAL_DIR/);
  });

  it('resolves localDirAbs against cwd', () => {
    const config = resolveStorageConfig({
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: 'uploads',
    });

    expect(config.driver).toBe('local');
    expect(config.localDirAbs).toBe(
      require('node:path').resolve(process.cwd(), 'uploads'),
    );
    expect(config.clientOptions).toBeUndefined();
  });

  it('reads STORAGE_PRESIGN_TTL_SECONDS', () => {
    const config = resolveStorageConfig({
      ...baseEnv,
      STORAGE_PRESIGN_TTL_SECONDS: '60',
    });

    expect(config.presignTtlSeconds).toBe(60);
  });

  it('throws on a non-positive presign TTL', () => {
    expect(() =>
      resolveStorageConfig({
        ...baseEnv,
        STORAGE_PRESIGN_TTL_SECONDS: '0',
      }),
    ).toThrow(/positive integer/);
  });

  it('keeps the default driver when STORAGE_DRIVER is unset', () => {
    const config = resolveStorageConfig({
      STORAGE_BUCKET: 'nexus-documents',
      MINIO_ENDPOINT: 'localhost',
      MINIO_API_PORT: '9000',
    });

    expect(config.driver).toBe('minio');
  });
});
