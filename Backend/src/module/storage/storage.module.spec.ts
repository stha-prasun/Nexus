import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { TracingService } from '../../common/tracing/tracing.service';
import { STORAGE_CLIENT } from './constants/storage.constants';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

// In the app TracingService comes from the @Global CommonModule; isolate the
// leaf module by registering an equivalent global stub.
const tracing = {
  begin: jest.fn().mockReturnValue({
    run: <T>(fn: () => T): T => fn(),
    end: jest.fn(),
  }),
};

@Global()
@Module({
  providers: [{ provide: TracingService, useValue: tracing }],
  exports: [TracingService],
})
class TracingStubModule {}

describe('StorageModule', () => {
  let module: TestingModule | undefined;

  const previousEnv = { ...process.env };

  const compile = async (env: Record<string, string>) => {
    Object.assign(process.env, env);
    return Test.createTestingModule({
      imports: [TracingStubModule, StorageModule],
    }).compile();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith('STORAGE_') ||
        key.startsWith('MINIO_') ||
        key.startsWith('S3_')
      ) {
        delete process.env[key];
      }
    }
  });

  afterEach(async () => {
    await module?.close();
    module = undefined;
    process.env = { ...previousEnv };
  });

  it('exports StorageService and an S3Client for remote drivers', async () => {
    module = await compile({ STORAGE_DRIVER: 'minio' });

    const service = module.get(StorageService);
    const client = module.get<S3Client | null>(STORAGE_CLIENT);

    expect(service).toBeDefined();
    expect(client).toBeInstanceOf(S3Client);
  });

  it('provides a null client for the local driver', async () => {
    module = await compile({
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_DIR: 'uploads',
    });

    const client = module.get<S3Client | null>(STORAGE_CLIENT);
    const service = module.get(StorageService);

    expect(client).toBeNull();
    expect(service.driver).toBe('local');
  });

  it('fails fast on a bad STORAGE_DRIVER', async () => {
    await expect(compile({ STORAGE_DRIVER: 'gcs' })).rejects.toThrow(
      /STORAGE_DRIVER/,
    );
  });
});
