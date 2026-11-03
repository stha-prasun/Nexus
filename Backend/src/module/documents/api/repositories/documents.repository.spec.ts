import { Test, type TestingModule } from '@nestjs/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import { DocumentsRepository } from './documents.repository';

type Row = Record<string, unknown>;

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const documentRow = (overrides: Row = {}): Row => ({
  id: uuid(1),
  projectId: uuid(2),
  uploadedByUserId: uuid(3),
  originalName: 'Project brief.pdf',
  objectKey: `projects/${uuid(2)}/file.pdf`,
  mimeType: 'application/pdf',
  extension: 'pdf',
  sizeBytes: 1024,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  uploaderName: 'Maya',
  ...overrides,
});

describe('DocumentsRepository', () => {
  let repository: DocumentsRepository;

  /** Rows returned by the next select; insert returns `inserted`. */
  let selectRows: Row[];
  let inserted: Row[];
  let captured: {
    where?: unknown;
    orderBy?: unknown;
    limit?: number;
    values?: Row;
    deletedWhere?: unknown;
  };

  const chainable = (result: unknown) => {
    const tail = {
      where: (condition: unknown) => {
        captured.where = condition;
        return tail;
      },
      orderBy: (order: unknown) => {
        captured.orderBy = order;
        return Promise.resolve(result);
      },
      limit: (n: number) => {
        captured.limit = n;
        return Promise.resolve(result);
      },
      leftJoin: () => tail,
      from: () => tail,
    };
    return tail;
  };

  const db = {
    select: jest.fn(() => chainable(selectRows)),
    insert: jest.fn(() => ({
      values: (values: Row) => {
        captured.values = values;
        return {
          returning: () => Promise.resolve(inserted),
        };
      },
    })),
    delete: jest.fn(() => ({
      where: (condition: unknown) => {
        captured.deletedWhere = condition;
        return Promise.resolve();
      },
    })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    selectRows = [];
    inserted = [];
    captured = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsRepository,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    repository = module.get<DocumentsRepository>(DocumentsRepository);
  });

  const conditionSql = (condition: unknown): string => {
    const { sql } = new PgDialect().sqlToQuery(condition as SQL);
    return sql;
  };

  describe('findProjectScope', () => {
    it('returns null when the project does not exist', async () => {
      selectRows = [];

      expect(await repository.findProjectScope(uuid(2), uuid(3))).toBeNull();
      expect(db.select).toHaveBeenCalled();
    });

    it('reports membership from the project_members lookup', async () => {
      // First select: project row; second: membership row.
      selectRows = [{ id: uuid(2), name: 'Website relaunch' }];

      db.select
        .mockReturnValueOnce(
          chainable([{ id: uuid(2), name: 'Website relaunch' }]),
        )
        .mockReturnValueOnce(chainable([{ isLead: true }]));

      const scope = await repository.findProjectScope(uuid(2), uuid(3));

      expect(scope).toEqual({
        id: uuid(2),
        name: 'Website relaunch',
        isMember: true,
        isLead: true,
      });
    });

    it('isMember=false when no project_members row matches', async () => {
      db.select
        .mockReturnValueOnce(chainable([{ id: uuid(2), name: 'Relaunch' }]))
        .mockReturnValueOnce(chainable([]));

      const scope = await repository.findProjectScope(uuid(2), uuid(3));

      expect(scope).toEqual({
        id: uuid(2),
        name: 'Relaunch',
        isMember: false,
        isLead: false,
      });
    });
  });

  describe('listByProject', () => {
    it('maps rows to Document entities with the uploader summary', async () => {
      selectRows = [
        documentRow(),
        documentRow({ id: uuid(9), uploaderName: 'Jonas' }),
      ];

      const documents = await repository.listByProject(uuid(2));

      expect(documents).toHaveLength(2);
      expect(documents[0]).toEqual(
        expect.objectContaining({
          id: uuid(1),
          originalName: 'Project brief.pdf',
          sizeBytes: 1024,
          extension: 'pdf',
          uploader: { id: uuid(3), name: 'Maya' },
        }),
      );
      expect(documents[1].uploader.name).toBe('Jonas');
    });

    it('coerces bigint string sizes to numbers', async () => {
      selectRows = [documentRow({ sizeBytes: '26214400' })];

      const [document] = await repository.listByProject(uuid(2));

      expect(document.sizeBytes).toBe(26_214_400);
    });

    it('falls back to "Unknown" when the uploader row is missing', async () => {
      selectRows = [documentRow({ uploaderName: null })];

      const [document] = await repository.listByProject(uuid(2));

      expect(document.uploader.name).toBe('Unknown');
    });
  });

  describe('findById', () => {
    it('returns the hydrated document or null', async () => {
      selectRows = [documentRow()];
      expect(await repository.findById(uuid(1))).not.toBeNull();

      selectRows = [];
      expect(await repository.findById(uuid(99))).toBeNull();
    });

    it('limits the lookup to one row', async () => {
      selectRows = [documentRow()];

      await repository.findById(uuid(1));

      expect(captured.limit).toBe(1);
    });
  });

  describe('create', () => {
    it('inserts the factory input and reloads the hydrated row', async () => {
      inserted = [{ id: uuid(1) }];
      selectRows = [documentRow()];

      const input = {
        id: uuid(1),
        projectId: uuid(2),
        uploadedByUserId: uuid(3),
        originalName: 'Project brief.pdf',
        objectKey: `projects/${uuid(2)}/file.pdf`,
        mimeType: 'application/pdf',
        extension: 'pdf' as const,
        sizeBytes: 1024,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };

      const document = await repository.create(input);

      expect(db.insert).toHaveBeenCalled();
      expect(captured.values).toEqual({
        id: uuid(1),
        projectId: uuid(2),
        uploadedByUserId: uuid(3),
        originalName: 'Project brief.pdf',
        objectKey: `projects/${uuid(2)}/file.pdf`,
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 1024,
        createdAt: input.createdAt,
      });
      expect(document.id).toBe(uuid(1));
    });

    it('throws when the insert returns no id', async () => {
      inserted = [];

      await expect(repository.create({} as never)).rejects.toThrow(
        'document insert returned no id',
      );
    });
  });

  describe('remove', () => {
    it('deletes by row id', async () => {
      await repository.remove(uuid(1));

      expect(db.delete).toHaveBeenCalled();
      expect(captured.deletedWhere).toBeDefined();
      expect(conditionSql(captured.deletedWhere)).toMatch(/"id" = /);
    });
  });
});
