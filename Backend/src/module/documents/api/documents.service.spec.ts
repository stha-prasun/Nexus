import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { SessionUser } from '../../auth/api/session/session.types';
import { MAX_FILE_BYTES } from './constants/documents.constants';
import { DocumentsService } from './documents.service';
import { Document } from './entities/document.entity';
import { DocumentFactory } from './factories/document.factory';
import type { ProjectScope } from './interfaces/document.interfaces';
import { DocumentsPolicy } from './policies/documents.policy';
import { DocumentsRepository } from './repositories/documents.repository';
import { DocumentsStorage } from './storage/documents.storage';
import type { UploadedFile } from './validation/file.validator';

type ErrorShape = {
  status: number;
  response: { status: string; message?: string };
};

describe('DocumentsService', () => {
  let service: DocumentsService;

  const T0 = new Date('2026-01-01T00:00:00Z');

  const admin: SessionUser = {
    userId: 'actor-admin',
    role: 'Admin',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  };
  const pm: SessionUser = {
    userId: 'actor-pm',
    role: 'PM',
    name: 'Maya Kim',
    email: 'maya@example.com',
  };
  const dev: SessionUser = {
    userId: 'actor-dev',
    role: 'Dev',
    name: 'Grace Hopper',
    email: 'grace@example.com',
  };
  const hr: SessionUser = {
    userId: 'actor-hr',
    role: 'HR',
    name: 'Helen Admin',
    email: 'hr@example.com',
  };

  const memberScope: ProjectScope = {
    id: 'proj-1',
    name: 'Website relaunch',
    isMember: true,
    isLead: false,
  };
  const nonMemberScope: ProjectScope = { ...memberScope, isMember: false };

  const documentEntity = (
    overrides: Partial<ConstructorParameters<typeof Document>[0]> = {},
  ): Document =>
    new Document({
      id: 'doc-1',
      projectId: 'proj-1',
      uploadedByUserId: admin.userId,
      originalName: 'Project brief.pdf',
      objectKey: 'projects/proj-1/doc-uuid.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 1_258_291,
      uploader: { id: admin.userId, name: admin.name },
      createdAt: T0,
      ...overrides,
    });

  const validFile = (overrides: Partial<UploadedFile> = {}): UploadedFile => ({
    originalname: 'Project brief.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('%PDF-1.7 x', 'ascii'),
    ...overrides,
  });

  const repository = {
    findProjectScope: jest.fn(),
    listByProject: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    remove: jest.fn(),
  };
  const storage = {
    driver: 'minio' as string,
    buildObjectKey: jest.fn(),
    put: jest.fn(),
    resolveDownload: jest.fn(),
    remove: jest.fn(),
    contentDisposition: jest.fn(),
  };

  const expectStatus = async (
    promise: Promise<unknown>,
    status: string,
    httpStatus: number,
  ): Promise<void> => {
    try {
      await promise;
      throw new Error(`expected an exception with status ${status}`);
    } catch (error) {
      const ctor =
        httpStatus === 404
          ? NotFoundException
          : httpStatus === 403
            ? ForbiddenException
            : httpStatus === 413
              ? PayloadTooLargeException
              : httpStatus === 415
                ? UnsupportedMediaTypeException
                : BadRequestException;
      expect(error).toBeInstanceOf(ctor);
      expect((error as ErrorShape).response.status).toBe(status);
      expect((error as ErrorShape).status).toBe(httpStatus);
    }
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storage.driver = 'minio';
    repository.findProjectScope.mockResolvedValue(memberScope);
    repository.listByProject.mockResolvedValue([documentEntity()]);
    repository.findById.mockResolvedValue(documentEntity());
    repository.create.mockResolvedValue(documentEntity());
    repository.remove.mockResolvedValue(undefined);
    storage.buildObjectKey.mockReturnValue('projects/proj-1/new-uuid.pdf');
    storage.put.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
    storage.contentDisposition.mockReturnValue('inline; filename="x"');
    storage.resolveDownload.mockResolvedValue({
      kind: 'redirect',
      url: 'https://minio.local/bucket/key?sig=…',
      expiresInSeconds: 300,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DocumentsRepository, useValue: repository },
        DocumentsPolicy,
        DocumentFactory,
        { provide: DocumentsStorage, useValue: storage },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  // ------------------------------------------------------------- visibility

  describe('requireVisible — 404 for invisible projects (no existence leak)', () => {
    it('list: non-member PM gets 404 document_project_not_found', async () => {
      repository.findProjectScope.mockResolvedValue(nonMemberScope);

      await expectStatus(
        service.list('proj-1', pm),
        'document_project_not_found',
        404,
      );
    });

    it('list: missing project (scope null) is the same 404', async () => {
      repository.findProjectScope.mockResolvedValue(null);

      await expectStatus(
        service.list('proj-1', dev),
        'document_project_not_found',
        404,
      );
    });

    it('list: Admin and HR see any project without membership', async () => {
      repository.findProjectScope.mockResolvedValue(nonMemberScope);

      const adminList = await service.list('proj-1', admin);
      const hrList = await service.list('proj-1', hr);

      expect(adminList.documents).toHaveLength(1);
      expect(hrList.documents).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------- upload

  describe('upload', () => {
    it('happy path: validates, puts to storage, inserts the row', async () => {
      const result = await service.upload('proj-1', validFile(), pm);

      expect(storage.buildObjectKey).toHaveBeenCalledWith('proj-1', 'pdf');
      expect(storage.put).toHaveBeenCalledWith(
        'projects/proj-1/new-uuid.pdf',
        expect.any(Buffer),
        { contentType: 'application/pdf', contentLength: 1024 },
      );
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          uploadedByUserId: pm.userId,
          objectKey: 'projects/proj-1/new-uuid.pdf',
          extension: 'pdf',
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 'doc-1' }));
    });

    it('plain member Dev gets 403 role_forbidden (visible but forbidden)', async () => {
      await expectStatus(
        service.upload('proj-1', validFile(), dev),
        'role_forbidden',
        403,
      );
      expect(storage.put).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('HR gets 403 role_forbidden', async () => {
      await expectStatus(
        service.upload('proj-1', validFile(), hr),
        'role_forbidden',
        403,
      );
    });

    it('non-member PM gets 404 before the manage check', async () => {
      repository.findProjectScope.mockResolvedValue(nonMemberScope);

      await expectStatus(
        service.upload('proj-1', validFile(), pm),
        'document_project_not_found',
        404,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('validation failures surface before storage is touched', async () => {
      await expectStatus(
        service.upload(
          'proj-1',
          validFile({ size: 0, buffer: Buffer.alloc(0) }),
          admin,
        ),
        'file_empty',
        400,
      );

      await expectStatus(
        service.upload(
          'proj-1',
          validFile({ originalname: 'evil.exe' }),
          admin,
        ),
        'file_extension_not_allowed',
        415,
      );

      await expectStatus(
        service.upload(
          'proj-1',
          validFile({ size: MAX_FILE_BYTES + 1 }),
          admin,
        ),
        'file_too_large',
        413,
      );

      await expectStatus(
        service.upload(
          'proj-1',
          validFile({ buffer: Buffer.from('MZ\u0090\u0000', 'binary') }),
          admin,
        ),
        'file_content_mismatch',
        415,
      );

      expect(storage.put).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------- download

  describe('download', () => {
    it('minio driver: resolves a presigned URL only after requireVisible', async () => {
      const result = await service.download('proj-1', 'doc-1', pm);

      expect(repository.findById).toHaveBeenCalledWith('doc-1');
      expect(storage.resolveDownload).toHaveBeenCalledWith(
        'projects/proj-1/doc-uuid.pdf',
        'Project brief.pdf',
        'pdf',
      );
      expect(result).toEqual({
        url: 'https://minio.local/bucket/key?sig=…',
        expiresInSeconds: 300,
      });
    });

    it('local driver: relative content path + 0 (no presign)', async () => {
      storage.driver = 'local';

      const result = await service.download('proj-1', 'doc-1', pm);

      expect(result).toEqual({
        url: '/api/v1/projects/proj-1/documents/doc-1/download/content',
        expiresInSeconds: 0,
      });
      expect(storage.resolveDownload).not.toHaveBeenCalled();
    });

    it('invisible project: 404, no URL issued', async () => {
      repository.findProjectScope.mockResolvedValue(nonMemberScope);

      await expectStatus(
        service.download('proj-1', 'doc-1', dev),
        'document_project_not_found',
        404,
      );
      expect(storage.resolveDownload).not.toHaveBeenCalled();
    });

    it('missing document: 404 document_not_found', async () => {
      repository.findById.mockResolvedValue(null);

      await expectStatus(
        service.download('proj-1', 'doc-missing', pm),
        'document_not_found',
        404,
      );
      expect(storage.resolveDownload).not.toHaveBeenCalled();
    });

    it('a document of another project in the URL: 404 (no cross-project read)', async () => {
      repository.findById.mockResolvedValue(
        documentEntity({ projectId: 'proj-2' }),
      );

      await expectStatus(
        service.download('proj-1', 'doc-1', admin),
        'document_not_found',
        404,
      );
    });
  });

  // --------------------------------------------------------- download/content

  describe('downloadContent (local driver only)', () => {
    it('streams the file for the local driver after authz', async () => {
      storage.driver = 'local';
      storage.resolveDownload.mockResolvedValue({
        kind: 'file',
        absolutePath: 'C:\\uploads\\projects\\proj-1\\doc-uuid.pdf',
      });

      const result = await service.downloadContent('proj-1', 'doc-1', pm);

      expect(result.absolutePath).toBe(
        'C:\\uploads\\projects\\proj-1\\doc-uuid.pdf',
      );
      expect(result.document.originalName).toBe('Project brief.pdf');
    });

    it('404 when the driver is not local', async () => {
      storage.driver = 'minio';

      await expectStatus(
        service.downloadContent('proj-1', 'doc-1', admin),
        'document_not_found',
        404,
      );
      expect(storage.resolveDownload).not.toHaveBeenCalled();
    });

    it('authz still runs: invisible project 404 even on the local driver', async () => {
      storage.driver = 'local';
      repository.findProjectScope.mockResolvedValue(nonMemberScope);

      await expectStatus(
        service.downloadContent('proj-1', 'doc-1', dev),
        'document_project_not_found',
        404,
      );
    });

    it('missing file on disk: 404 document_file_missing from the storage layer', async () => {
      storage.driver = 'local';
      storage.resolveDownload.mockRejectedValue(
        new NotFoundException({
          status: 'document_file_missing',
          message: 'Document file not found.',
        }),
      );

      await expectStatus(
        service.downloadContent('proj-1', 'doc-1', pm),
        'document_file_missing',
        404,
      );
    });
  });

  // ---------------------------------------------------------------- delete

  describe('remove', () => {
    it('removes the storage object first, then the row', async () => {
      const order: string[] = [];
      storage.remove.mockImplementation(async () => {
        order.push('storage');
      });
      repository.remove.mockImplementation(async () => {
        order.push('row');
      });

      await service.remove('proj-1', 'doc-1', pm);

      expect(order).toEqual(['storage', 'row']);
      expect(storage.remove).toHaveBeenCalledWith(
        'projects/proj-1/doc-uuid.pdf',
      );
      expect(repository.remove).toHaveBeenCalledWith('doc-1');
    });

    it('plain Dev: 403 role_forbidden, nothing removed', async () => {
      await expectStatus(
        service.remove('proj-1', 'doc-1', dev),
        'role_forbidden',
        403,
      );
      expect(storage.remove).not.toHaveBeenCalled();
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('non-member PM: 404, nothing removed', async () => {
      repository.findProjectScope.mockResolvedValue(nonMemberScope);

      await expectStatus(
        service.remove('proj-1', 'doc-1', pm),
        'document_project_not_found',
        404,
      );
      expect(storage.remove).not.toHaveBeenCalled();
    });

    it('missing document: 404 document_not_found', async () => {
      repository.findById.mockResolvedValue(null);

      await expectStatus(
        service.remove('proj-1', 'doc-missing', pm),
        'document_not_found',
        404,
      );
      expect(storage.remove).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------ disposition

  it('dispositionFor delegates to the shared SVG/inline policy', () => {
    storage.contentDisposition.mockReturnValue('attachment; filename="x"');

    expect(service.dispositionFor(documentEntity())).toBe(
      'attachment; filename="x"',
    );
    expect(storage.contentDisposition).toHaveBeenCalledWith(
      'Project brief.pdf',
      'pdf',
    );
  });
});
