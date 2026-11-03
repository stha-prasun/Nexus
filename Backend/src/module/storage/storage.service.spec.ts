import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { TracingService } from '../../common/tracing/tracing.service';
import { STORAGE_CLIENT } from './constants/storage.constants';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

type SpanHandle = { run: <T>(fn: () => T) => T; end: jest.Mock };

describe('StorageService', () => {
  const send = jest.fn();
  const begin = jest.fn();
  const span: SpanHandle = {
    run: (fn) => fn(),
    end: jest.fn(),
  };

  const tracing = { begin } as unknown as TracingService;
  const client = { send };

  const build = async (env: Record<string, string | undefined>) => {
    const previous = { ...process.env };
    Object.assign(process.env, env);
    // Drop keys the test does not set so defaults do not leak in.
    for (const key of Object.keys(env)) {
      if (env[key] === undefined) delete process.env[key];
    }
    try {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          { provide: STORAGE_CLIENT, useValue: client },
          { provide: TracingService, useValue: tracing },
        ],
      }).compile();
      return module.get(StorageService);
    } finally {
      process.env = previous;
    }
  };

  const remoteEnv = {
    STORAGE_DRIVER: 'minio',
    STORAGE_BUCKET: 'nexus-documents',
    MINIO_ENDPOINT: 'localhost',
    MINIO_API_PORT: '9000',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    begin.mockReturnValue(span);
  });

  describe('remote (minio)', () => {
    it('exposes the driver', async () => {
      const service = await build(remoteEnv);
      expect(service.driver).toBe('minio');
    });

    it('onModuleInit succeeds when the bucket already exists', async () => {
      send.mockResolvedValueOnce({});
      const service = await build(remoteEnv);

      await service.onModuleInit();

      expect(send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
      expect(begin).toHaveBeenCalledWith('minio', 'HEAD nexus-documents');
      expect(span.end).toHaveBeenCalled();
    });

    it('onModuleInit creates the bucket on NotFound', async () => {
      send
        .mockRejectedValueOnce(
          Object.assign(new Error('not found'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          }),
        )
        .mockResolvedValueOnce({});
      const service = await build(remoteEnv);

      await service.onModuleInit();

      expect(send.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
      expect(span.end).toHaveBeenCalledTimes(2);
    });

    it('onModuleInit ignores BucketAlreadyOwnedByYou', async () => {
      send
        .mockRejectedValueOnce(
          Object.assign(new Error('404'), { name: 'NotFound' }),
        )
        .mockRejectedValueOnce(
          Object.assign(new Error('owned'), {
            name: 'BucketAlreadyOwnedByYou',
          }),
        );
      const service = await build(remoteEnv);

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('put sends a PutObjectCommand with the right params', async () => {
      send.mockResolvedValue({});
      const service = await build(remoteEnv);
      const body = Buffer.from('hello');

      await service.put('projects/p1/a.pdf', body, {
        contentType: 'application/pdf',
        contentLength: 5,
      });

      const command = send.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: 'nexus-documents',
        Key: 'projects/p1/a.pdf',
        ContentType: 'application/pdf',
        ContentLength: 5,
      });
      expect(begin).toHaveBeenCalledWith('minio', 'PUT projects/p1/a.pdf');
    });

    it('resolveDownload presigns a GET with the disposition and TTL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example');
      const service = await build(remoteEnv);

      const resolution = await service.resolveDownload(
        'projects/p1/a.pdf',
        'attachment; filename="a.pdf"',
      );

      expect(getSignedUrl).toHaveBeenCalledWith(
        client,
        expect.any(GetObjectCommand),
        { expiresIn: 300 },
      );
      const command = (getSignedUrl as jest.Mock).mock.calls[0][1];
      expect(command.input).toMatchObject({
        Bucket: 'nexus-documents',
        Key: 'projects/p1/a.pdf',
        ResponseContentDisposition: 'attachment; filename="a.pdf"',
      });
      expect(resolution).toEqual({
        kind: 'redirect',
        url: 'https://signed.example',
        expiresInSeconds: 300,
      });
      // Local signing — no span.
      expect(begin).not.toHaveBeenCalled();
    });

    it('resolveDownload honors STORAGE_PRESIGN_TTL_SECONDS', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example');
      const service = await build({
        ...remoteEnv,
        STORAGE_PRESIGN_TTL_SECONDS: '60',
      });

      const resolution = await service.resolveDownload('k', 'inline');

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 60 },
      );
      expect(resolution).toMatchObject({ expiresInSeconds: 60 });
    });

    it('remove sends a RemoveObjectCommand', async () => {
      send.mockResolvedValue({});
      const service = await build(remoteEnv);

      await service.remove('projects/p1/a.pdf');

      expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
      expect(begin).toHaveBeenCalledWith('minio', 'DELETE projects/p1/a.pdf');
    });

    it('probe sends a ListBucketsCommand', async () => {
      send.mockResolvedValue({ Buckets: [] });
      const service = await build(remoteEnv);

      await service.probe();

      expect(send.mock.calls[0][0]).toBeInstanceOf(ListBucketsCommand);
      expect(begin).toHaveBeenCalledWith('minio', 'LIST buckets');
    });

    it('propagates send failures through the span end', async () => {
      const failure = new Error('network down');
      send.mockRejectedValue(failure);
      const service = await build(remoteEnv);

      await expect(service.probe()).rejects.toThrow('network down');
      expect(span.end).toHaveBeenCalledWith(failure);
    });
  });

  describe('local', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'nexus-storage-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const buildLocal = () =>
      build({
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_DIR: dir,
        STORAGE_BUCKET: '',
      });

    it('exposes the driver and creates the directory on init', async () => {
      const service = await buildLocal();

      await service.onModuleInit();

      expect(service.driver).toBe('local');
      // mkdir ran without error against the temp dir.
      expect(begin).not.toHaveBeenCalled();
    });

    it('put writes the bytes under the local dir (nested key)', async () => {
      const service = await buildLocal();

      await service.put('projects/p1/deep/a.txt', Buffer.from('hello'), {
        contentType: 'text/plain',
        contentLength: 5,
      });

      const written = await readFile(
        path.join(dir, 'projects', 'p1', 'deep', 'a.txt'),
        'utf8',
      );
      expect(written).toBe('hello');
      expect(begin).not.toHaveBeenCalled();
    });

    it('resolveDownload returns the absolute path when the file exists', async () => {
      const service = await buildLocal();
      const key = 'projects/p1/a.txt';
      await service.put(key, Buffer.from('x'), {
        contentType: 'text/plain',
        contentLength: 1,
      });

      const resolution = await service.resolveDownload(key, 'inline');

      expect(resolution).toEqual({
        kind: 'file',
        absolutePath: path.join(dir, key),
      });
      expect(begin).not.toHaveBeenCalled();
    });

    it('rejects a traversal key', async () => {
      const service = await buildLocal();

      await expect(
        service.resolveDownload('../../etc/passwd', 'inline'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.put('../../etc/passwd', Buffer.from('x'), {
          contentType: 'text/plain',
          contentLength: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws document_file_missing when the file is absent', async () => {
      const service = await buildLocal();

      await expect(
        service.resolveDownload('projects/p1/missing.txt', 'inline'),
      ).rejects.toMatchObject({
        response: {
          status: 'document_file_missing',
        },
      });
      await expect(
        service.resolveDownload('projects/p1/missing.txt', 'inline'),
      ).rejects.toThrow(NotFoundException);
    });

    it('remove unlinks the file and tolerates ENOENT', async () => {
      const service = await buildLocal();
      const key = 'projects/p1/a.txt';
      await service.put(key, Buffer.from('x'), {
        contentType: 'text/plain',
        contentLength: 1,
      });

      await service.remove(key);
      await expect(service.remove(key)).resolves.toBeUndefined();

      await expect(readFile(path.join(dir, key))).rejects.toThrow();
    });

    it('probe checks the directory is writable', async () => {
      const service = await buildLocal();

      await expect(service.probe()).resolves.toBeUndefined();
      expect(begin).not.toHaveBeenCalled();
    });
  });
});
