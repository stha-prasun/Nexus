import { BadRequestException } from '@nestjs/common';
import {
  EXCEPTION_FILTERS_METADATA,
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  INTERCEPTORS_METADATA,
} from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../../common/decorators';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { SessionService } from '../../auth/api/session/session.service';
import { ActiveMemberGuard } from '../../members/api/guards/active-member.guard';
import { MembersRepository } from '../../members/api/repositories/members.repository';
import { MAX_FILE_BYTES } from './constants/documents.constants';
import {
  DocumentsController,
  uploadInterceptorOptions,
} from './documents.controller';
import { DocumentsService } from './documents.service';
import { Document } from './entities/document.entity';
import { MulterExceptionFilter } from './validation/multer-exception.filter';

describe('DocumentsController', () => {
  let controller: DocumentsController;

  const T0 = new Date('2026-01-01T00:00:00Z');

  const documentsService = {
    list: jest.fn(),
    upload: jest.fn(),
    download: jest.fn(),
    downloadContent: jest.fn(),
    dispositionFor: jest.fn(),
    remove: jest.fn(),
  };

  const documentEntity = (
    overrides: Partial<ConstructorParameters<typeof Document>[0]> = {},
  ): Document =>
    new Document({
      id: 'doc-1',
      projectId: 'proj-1',
      uploadedByUserId: 'actor-1',
      originalName: 'Project brief.pdf',
      objectKey: 'projects/proj-1/doc-uuid.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 1_258_291,
      uploader: { id: 'actor-1', name: 'Ada' },
      createdAt: T0,
      ...overrides,
    });

  const request = (file?: unknown): AuthenticatedRequest =>
    ({
      user: {
        userId: 'actor-1',
        role: 'Admin',
        name: 'Ada',
        email: 'ada@example.com',
      },
      file,
    }) as unknown as AuthenticatedRequest;

  const multerFile = {
    originalname: 'Project brief.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('%PDF-1.7', 'ascii'),
  };

  type Handler = (...args: never[]) => unknown;

  const handler = (name: keyof DocumentsController): Handler =>
    (DocumentsController.prototype as unknown as Record<string, Handler>)[name];

  const guardsOf = (target: Handler): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

  const interceptorsOf = (target: Handler): unknown[] =>
    Reflect.getMetadata(INTERCEPTORS_METADATA, target) ?? [];

  const filtersOf = (target: Handler): unknown[] =>
    Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, target) ?? [];

  beforeEach(async () => {
    jest.clearAllMocks();
    documentsService.dispositionFor.mockReturnValue('inline; filename="x"');

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        { provide: DocumentsService, useValue: documentsService },
        // Guard dependencies must be resolvable on the controller module.
        { provide: SessionService, useValue: {} },
        { provide: MembersRepository, useValue: {} },
      ],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('guard composition', () => {
    const routes = [
      'list',
      'upload',
      'download',
      'downloadContent',
      'remove',
    ] as const;

    it('every route: session + ActiveMemberGuard — and deliberately NO @Roles (the matrix is role+membership sensitive)', () => {
      for (const name of routes) {
        expect(guardsOf(handler(name))).toEqual([
          SessionAuthGuard,
          ActiveMemberGuard,
        ]);
        expect(Reflect.getMetadata(ROLES_KEY, handler(name))).toBeUndefined();
      }
    });

    it('upload: memoryStorage FileInterceptor (25 MB, one file) + MulterExceptionFilter', () => {
      const interceptors = interceptorsOf(handler('upload'));
      expect(interceptors).toHaveLength(1);
      expect(typeof interceptors[0]).toBe('function'); // FileInterceptor factory result

      const filters = filtersOf(handler('upload'));
      expect(filters).toContain(MulterExceptionFilter);

      // Only the upload route carries the multer plumbing.
      expect(interceptorsOf(handler('list'))).toHaveLength(0);
      expect(filtersOf(handler('list'))).toHaveLength(0);
    });

    it('POST upload answers 201; DELETE answers 200; GETs carry no explicit code', () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('upload'))).toBe(
        201,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('remove'))).toBe(
        200,
      );
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, handler('list')),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, handler('download')),
      ).toBeUndefined();
    });

    it('the upload interceptor is configured with memoryStorage and the 25 MB / single-file limits', () => {
      expect(uploadInterceptorOptions.limits).toEqual({
        fileSize: MAX_FILE_BYTES,
        files: 1,
      });
      expect(uploadInterceptorOptions.storage).toBeDefined();
    });
  });

  describe('delegation', () => {
    it('list forwards projectId + session user and maps entities to responses', async () => {
      documentsService.list.mockResolvedValue({
        documents: [documentEntity()],
      });

      const result = await controller.list('proj-1', request());

      expect(documentsService.list).toHaveBeenCalledWith(
        'proj-1',
        request().user,
      );
      expect(result.documents).toEqual([
        expect.objectContaining({
          id: 'doc-1',
          name: 'Project brief.pdf',
          size: 1_258_291,
          extension: 'pdf',
          uploadedBy: { id: 'actor-1', name: 'Ada' },
        }),
      ]);
    });

    it('upload forwards the multer file + session user and wraps the document', async () => {
      documentsService.upload.mockResolvedValue(documentEntity());

      const result = await controller.upload(
        'proj-1',
        request(multerFile) as never,
      );

      expect(documentsService.upload).toHaveBeenCalledWith(
        'proj-1',
        multerFile,
        request().user,
      );
      expect(result).toEqual({
        document: expect.objectContaining({ id: 'doc-1' }),
      });
    });

    it('upload without a file → 400 file_required (service never called)', async () => {
      try {
        await controller.upload('proj-1', request(undefined) as never);
        throw new Error('expected 400');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect(
          (error as { response: { status: string } }).response.status,
        ).toBe('file_required');
      }
      expect(documentsService.upload).not.toHaveBeenCalled();
    });

    it('download forwards both ids + session user and returns the JSON contract', async () => {
      documentsService.download.mockResolvedValue({
        url: 'https://minio.local/bucket/key?sig=…',
        expiresInSeconds: 300,
      });

      const result = await controller.download('proj-1', 'doc-1', request());

      expect(documentsService.download).toHaveBeenCalledWith(
        'proj-1',
        'doc-1',
        request().user,
      );
      expect(result).toEqual({
        url: 'https://minio.local/bucket/key?sig=…',
        expiresInSeconds: 300,
      });
    });

    it('download contract for the local driver: relative path + 0', async () => {
      documentsService.download.mockResolvedValue({
        url: '/api/v1/projects/proj-1/documents/doc-1/download/content',
        expiresInSeconds: 0,
      });

      const result = await controller.download('proj-1', 'doc-1', request());

      expect(result).toEqual({
        url: '/api/v1/projects/proj-1/documents/doc-1/download/content',
        expiresInSeconds: 0,
      });
    });

    it('downloadContent sets stream headers from the shared policy and sends the file', async () => {
      documentsService.downloadContent.mockResolvedValue({
        absolutePath: 'C:\\uploads\\projects\\proj-1\\doc-uuid.pdf',
        document: documentEntity(),
      });
      const headers: Record<string, string> = {};
      const res = {
        setHeader: jest.fn((key: string, value: string) => {
          headers[key] = value;
        }),
        sendFile: jest.fn(),
      };

      await controller.downloadContent(
        'proj-1',
        'doc-1',
        request(),
        res as never,
      );

      expect(documentsService.downloadContent).toHaveBeenCalledWith(
        'proj-1',
        'doc-1',
        request().user,
      );
      expect(res.sendFile).toHaveBeenCalledWith(
        'C:\\uploads\\projects\\proj-1\\doc-uuid.pdf',
      );
      expect(headers['Content-Type']).toBe('application/pdf');
      expect(headers['Content-Length']).toBe('1258291');
      expect(documentsService.dispositionFor).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'doc-1' }),
      );
      expect(headers['Content-Disposition']).toBe('inline; filename="x"');
    });

    it('downloadContent on a non-local driver: service answers 404 before headers', async () => {
      documentsService.downloadContent.mockRejectedValue(
        Object.assign(new Error('not found'), {
          getStatus: () => 404,
          response: { status: 'document_not_found' },
        }),
      );
      const res = { setHeader: jest.fn(), sendFile: jest.fn() };

      await expect(
        controller.downloadContent('proj-1', 'doc-1', request(), res as never),
      ).rejects.toThrow('not found');

      expect(res.setHeader).not.toHaveBeenCalled();
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('remove forwards both ids + session user and answers with message + deleted', async () => {
      documentsService.remove.mockResolvedValue(undefined);

      const result = await controller.remove('proj-1', 'doc-1', request());

      expect(documentsService.remove).toHaveBeenCalledWith(
        'proj-1',
        'doc-1',
        request().user,
      );
      expect(result).toEqual({
        message: 'Document deleted successfully.',
        deleted: 1,
      });
    });
  });
});
