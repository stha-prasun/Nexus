import { DocumentFactory, type ValidatedFile } from './document.factory';

describe('DocumentFactory', () => {
  const factory = new DocumentFactory();

  const file: ValidatedFile = {
    originalName: 'Project brief.pdf',
    mimeType: 'application/pdf',
    extension: 'pdf',
    sizeBytes: 1_258_291,
  };

  const context = {
    projectId: 'proj-1',
    uploadedByUserId: 'user-1',
    objectKey: 'projects/proj-1/9f2c4d6e-0000-4000-8000-000000000001.pdf',
  };

  it('stamps a fresh uuid id and createdAt', () => {
    const before = Date.now();
    const input = factory.create(file, context);

    expect(input.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(input.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('carries the validated file fields through unchanged', () => {
    const input = factory.create(file, context);

    expect(input).toEqual({
      id: expect.any(String),
      projectId: 'proj-1',
      uploadedByUserId: 'user-1',
      originalName: 'Project brief.pdf',
      objectKey: context.objectKey,
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 1_258_291,
      createdAt: expect.any(Date),
    });
  });

  it('never derives the object key itself — the supplied key wins', () => {
    const input = factory.create(file, {
      ...context,
      objectKey: 'projects/proj-1/other-uuid.png',
    });

    expect(input.objectKey).toBe('projects/proj-1/other-uuid.png');
    expect(input.extension).toBe('pdf'); // extension is metadata, not key-derived
  });

  it('issues distinct ids per call', () => {
    const first = factory.create(file, context);
    const second = factory.create(file, context);

    expect(first.id).not.toBe(second.id);
  });
});
