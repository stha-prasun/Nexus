import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
} from '../constants/documents.constants';
import type { UploadedFile } from './file.validator';
import {
  assertContent,
  assertExtension,
  assertMimeType,
  assertSize,
  extensionOf,
  matchesContent,
  sanitizeFilename,
  validateUpload,
} from './file.validator';

const file = (overrides: Partial<UploadedFile> = {}): UploadedFile => ({
  originalname: 'Project brief.pdf',
  mimetype: 'application/pdf',
  size: 1024,
  buffer: Buffer.from('%PDF-1.7\n%abc', 'ascii'),
  ...overrides,
});

type ErrorCtor = new (...args: never[]) => Error;

const expectStatus = (
  run: () => unknown,
  status: string,
  ctor: ErrorCtor,
): void => {
  try {
    run();
    throw new Error(`expected an exception with status ${status}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    expect((error as { response: { status: string } }).response.status).toBe(
      status,
    );
  }
};

describe('file.validator', () => {
  describe('extensionOf', () => {
    it('lowercases the extension after the last dot', () => {
      expect(extensionOf('Photo.JPG')).toBe('jpg');
      expect(extensionOf('archive.tar.zip')).toBe('zip');
    });

    it('returns empty for no dot, leading dot, or trailing dot', () => {
      expect(extensionOf('README')).toBe('');
      expect(extensionOf('.gitignore')).toBe('');
      expect(extensionOf('folder/')).toBe('');
    });

    it('ignores path components', () => {
      expect(extensionOf('../../etc/passwd.pdf')).toBe('pdf');
      expect(extensionOf('C:\\Users\\x\\file.PNG')).toBe('png');
    });
  });

  describe('assertSize', () => {
    it('accepts a positive size within the limit', () => {
      expect(() => assertSize(1)).not.toThrow();
      expect(() => assertSize(MAX_FILE_BYTES)).not.toThrow();
    });

    it('zero-byte → 400 file_empty', () => {
      expectStatus(() => assertSize(0), 'file_empty', BadRequestException);
      expectStatus(() => assertSize(-1), 'file_empty', BadRequestException);
    });

    it('over 25 MB → 413 file_too_large', () => {
      expectStatus(
        () => assertSize(MAX_FILE_BYTES + 1),
        'file_too_large',
        PayloadTooLargeException,
      );
    });
  });

  describe('assertExtension', () => {
    it('accepts every allowed extension (case-insensitive via extensionOf)', () => {
      for (const ext of ALLOWED_EXTENSIONS) {
        expect(assertExtension(ext)).toBe(ext);
      }
    });

    it('rejects disallowed extensions with 415', () => {
      for (const ext of ['exe', 'sh', 'js', 'bat', 'pdf ', '']) {
        expectStatus(
          () => assertExtension(ext),
          'file_extension_not_allowed',
          UnsupportedMediaTypeException,
        );
      }
    });
  });

  describe('assertMimeType', () => {
    it('accepts the canonical MIME and known legacy variants', () => {
      expect(() => assertMimeType('jpg', 'image/jpeg')).not.toThrow();
      expect(() => assertMimeType('jpg', 'image/jpg')).not.toThrow();
      expect(() =>
        assertMimeType(
          'docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      ).not.toThrow();
      expect(() => assertMimeType('svg', 'image/svg+xml')).not.toThrow();
    });

    it('rejects a MIME that does not belong to the extension → 415', () => {
      expectStatus(
        () => assertMimeType('pdf', 'image/png'),
        'file_mime_not_allowed',
        UnsupportedMediaTypeException,
      );
      expectStatus(
        () => assertMimeType('png', 'text/plain'),
        'file_mime_not_allowed',
        UnsupportedMediaTypeException,
      );
    });
  });

  describe('matchesContent — magic bytes', () => {
    const cases: [string, Buffer, boolean][] = [
      ['pdf', Buffer.from('%PDF-1.4', 'ascii'), true],
      ['pdf', Buffer.from('MZ\u0090\u0000', 'binary'), false],
      ['zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]), true],
      ['zip', Buffer.from('not a zip', 'ascii'), false],
      ['docx', Buffer.from([0x50, 0x4b, 0x03, 0x04]), true],
      ['xlsx', Buffer.from([0x50, 0x4b, 0x05, 0x06]), false],
      [
        'doc',
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        true,
      ],
      ['xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), false],
      [
        'ppt',
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        true,
      ],
      [
        'png',
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        true,
      ],
      ['png', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), false],
      ['jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), true],
      ['jpeg', Buffer.from([0xff, 0xd8, 0xff]), true],
      ['jpg', Buffer.from([0x89, 0x50, 0x4e, 0x47]), false],
      ['gif', Buffer.from('GIF87a...', 'ascii'), true],
      ['gif', Buffer.from('GIF89a...', 'ascii'), true],
      ['gif', Buffer.from('GIF90a...', 'ascii'), false],
    ];

    it.each(cases)('%s content accepted=%s', (ext, buffer, accepted) => {
      expect(
        matchesContent(ext as Parameters<typeof matchesContent>[0], buffer),
      ).toBe(accepted);
    });

    it('renamed exe (MZ header) as .pdf is rejected', () => {
      const exe = Buffer.concat([
        Buffer.from('MZ', 'ascii'),
        Buffer.from([0x90, 0x00, 0x03, 0x00]),
      ]);
      expect(() => assertContent('pdf', exe)).toThrow(
        UnsupportedMediaTypeException,
      );
    });
  });

  describe('matchesContent — text family', () => {
    it('clean UTF-8 text passes for txt/md/csv', () => {
      const body = Buffer.from('a,b,c\n1,2,3\n', 'utf8');
      expect(matchesContent('txt', body)).toBe(true);
      expect(matchesContent('md', body)).toBe(true);
      expect(matchesContent('csv', body)).toBe(true);
    });

    it('NUL bytes reject text files', () => {
      const body = Buffer.from([0x61, 0x00, 0x62]);
      expect(matchesContent('txt', body)).toBe(false);
      expect(matchesContent('csv', body)).toBe(false);
    });

    it('invalid UTF-8 rejects text files', () => {
      const body = Buffer.from([0xc3, 0x28, 0xa0, 0xa1]);
      expect(matchesContent('md', body)).toBe(false);
    });

    it('SVG accepts xml/svg/doctypes roots after BOM + whitespace', () => {
      const roots = [
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
        '\n  <svg xmlns="http://www.w3.org/2000/svg"></svg>',
        '<!DOCTYPE svg><svg/>',
        '\ufeff<svg/>',
      ];
      for (const root of roots) {
        expect(matchesContent('svg', Buffer.from(root, 'utf8'))).toBe(true);
      }
    });

    it('SVG rejects other roots and binary content', () => {
      expect(
        matchesContent('svg', Buffer.from('<html><body/></html>', 'utf8')),
      ).toBe(false);
      expect(matchesContent('svg', Buffer.from([0x89, 0x50, 0x00, 0x01]))).toBe(
        false,
      );
    });
  });

  describe('sanitizeFilename', () => {
    it('keeps a normal name intact', () => {
      expect(sanitizeFilename('Project brief.pdf', 'pdf')).toBe(
        'Project brief.pdf',
      );
    });

    it('strips path components (traversal)', () => {
      expect(sanitizeFilename('../../etc/passwd.pdf', 'pdf')).toBe(
        'passwd.pdf',
      );
      expect(sanitizeFilename('C:\\Users\\x\\report.pdf', 'pdf')).toBe(
        'report.pdf',
      );
    });

    it('removes control characters and NUL bytes', () => {
      expect(sanitizeFilename('bad\u0000name\u001f.pdf', 'pdf')).toBe(
        'badname.pdf',
      );
    });

    it('collapses whitespace runs', () => {
      expect(sanitizeFilename('  my   \t file .pdf', 'pdf')).toBe(
        'my file .pdf',
      );
    });

    it('forbids leading dots (hidden files)', () => {
      expect(sanitizeFilename('.hidden.pdf', 'pdf')).toBe('hidden.pdf');
      expect(sanitizeFilename('...secret.pdf', 'pdf')).toBe('secret.pdf');
    });

    it('caps at 200 characters', () => {
      const long = `${'a'.repeat(300)}.pdf`;
      expect(sanitizeFilename(long, 'pdf').length).toBe(200);
    });

    it('falls back to document.<ext> when nothing survives', () => {
      expect(sanitizeFilename('...', 'pdf')).toBe('document.pdf');
      expect(sanitizeFilename('\u0000\u001f', 'png')).toBe('document.png');
    });
  });

  describe('validateUpload — the pipeline end to end', () => {
    it('runs every rule in order and returns the factory input', () => {
      const result = validateUpload(file());

      expect(result).toEqual({
        originalName: 'Project brief.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024,
      });
    });

    it('empty file fails first (400) before extension checks', () => {
      expectStatus(
        () => validateUpload(file({ size: 0 })),
        'file_empty',
        BadRequestException,
      );
    });

    it('oversize file fails with 413', () => {
      expectStatus(
        () => validateUpload(file({ size: MAX_FILE_BYTES + 1 })),
        'file_too_large',
        PayloadTooLargeException,
      );
    });

    it('disallowed extension fails with 415 before MIME checks', () => {
      expectStatus(
        () => validateUpload(file({ originalname: 'evil.exe' })),
        'file_extension_not_allowed',
        UnsupportedMediaTypeException,
      );
    });

    it('MIME mismatch fails with 415 before content sniffing', () => {
      expectStatus(
        () => validateUpload(file({ mimetype: 'image/png' })),
        'file_mime_not_allowed',
        UnsupportedMediaTypeException,
      );
    });

    it('content mismatch fails with 415 (renamed binary)', () => {
      expectStatus(
        () =>
          validateUpload(
            file({ buffer: Buffer.from('MZ\u0090\u0000', 'binary') }),
          ),
        'file_content_mismatch',
        UnsupportedMediaTypeException,
      );
    });

    it('a fully valid upload passes with a sanitized name', () => {
      const result = validateUpload(
        file({
          originalname: '../../etc/\u0000invoice\u001f.pdf',
          buffer: Buffer.from('%PDF-1.4 x', 'ascii'),
        }),
      );

      expect(result.originalName).toBe('invoice.pdf');
      expect(result.extension).toBe('pdf');
      expect(result.mimeType).toBe('application/pdf');
    });

    it('stores the canonical MIME for the extension (image/jpg → image/jpeg)', () => {
      const result = validateUpload(
        file({
          originalname: 'photo.jpg',
          mimetype: 'image/jpg',
          buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        }),
      );

      expect(result.mimeType).toBe('image/jpeg');
    });
  });
});
