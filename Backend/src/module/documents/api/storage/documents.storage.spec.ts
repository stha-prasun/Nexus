import { Test, type TestingModule } from '@nestjs/testing';
import { StorageService } from '../../../storage/storage.service';
import { DocumentsStorage } from './documents.storage';

describe('DocumentsStorage', () => {
  let storage: DocumentsStorage;

  const storageService = {
    driver: 'minio',
    put: jest.fn(),
    resolveDownload: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storageService.driver = 'minio';
    storageService.resolveDownload.mockResolvedValue({
      kind: 'redirect',
      url: 'https://minio.local/bucket/key?sig=…',
      expiresInSeconds: 300,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsStorage,
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    storage = module.get<DocumentsStorage>(DocumentsStorage);
  });

  describe('buildObjectKey', () => {
    it('uses the projects/<projectId>/<uuid>.<ext> scheme for every driver', () => {
      const key = storage.buildObjectKey('proj-1', 'pdf');

      expect(key).toMatch(
        /^projects\/proj-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
      );
    });

    it('never embeds the original filename — random uuid every time', () => {
      const first = storage.buildObjectKey('proj-1', 'docx');
      const second = storage.buildObjectKey('proj-1', 'docx');

      expect(first).not.toBe(second);
      expect(first).not.toContain(' ');
      expect(first.endsWith('.docx')).toBe(true);
    });
  });

  describe('contentDisposition', () => {
    it('forces attachment for SVG (no inline script execution)', () => {
      const disposition = storage.contentDisposition('diagram.svg', 'svg');

      expect(disposition.startsWith('attachment;')).toBe(true);
      expect(disposition).toContain('filename=');
    });

    it('serves everything else inline with the sanitized name', () => {
      expect(storage.contentDisposition('brief.pdf', 'pdf')).toMatch(
        /^inline;/,
      );
      expect(storage.contentDisposition('photo.png', 'png')).toMatch(
        /^inline;/,
      );
    });

    it('RFC 5987-encodes the filename (spaces, unicode, quotes)', () => {
      const disposition = storage.contentDisposition('räpport 2026.pdf', 'pdf');

      expect(disposition).toContain("filename*=UTF-8''r%C3%A4pport%202026.pdf");
      // Quoted filename stays header-safe too.
      expect(disposition).toMatch(/filename="[^"]*"/);
      expect(disposition).not.toMatch(/filename="[^"]*[^\\]"[^;]*"/);
    });

    it('neutralizes quotes so the header cannot be broken out of', () => {
      const disposition = storage.contentDisposition('evil".pdf', 'pdf');

      // The raw quote never appears unencoded inside the quoted filename.
      const quoted = disposition.match(/filename="([^"]*)"/)?.[1] ?? '';
      expect(quoted).not.toContain('"');
      expect(disposition).toContain('%22');
    });
  });

  describe('delegation to StorageService', () => {
    it('put forwards body + contentType/contentLength', async () => {
      const body = Buffer.from('%PDF-1.7', 'ascii');

      await storage.put('projects/proj-1/x.pdf', body, {
        contentType: 'application/pdf',
        contentLength: body.length,
      });

      expect(storageService.put).toHaveBeenCalledWith(
        'projects/proj-1/x.pdf',
        body,
        { contentType: 'application/pdf', contentLength: body.length },
      );
    });

    it('resolveDownload passes the disposition built from the same policy', async () => {
      const resolution = await storage.resolveDownload(
        'projects/proj-1/x.svg',
        'diagram.svg',
        'svg',
      );

      expect(storageService.resolveDownload).toHaveBeenCalledWith(
        'projects/proj-1/x.svg',
        expect.stringContaining('attachment;'),
      );
      expect(resolution.kind).toBe('redirect');
    });

    it('remove forwards the key', async () => {
      await storage.remove('projects/proj-1/x.pdf');

      expect(storageService.remove).toHaveBeenCalledWith(
        'projects/proj-1/x.pdf',
      );
    });

    it('exposes the driver', () => {
      expect(storage.driver).toBe('minio');
      storageService.driver = 'local';
      expect(storage.driver).toBe('local');
    });
  });
});
