import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { SessionUser } from '../../auth/api/session/session.types';
import {
  EMPTY_UPDATE_MESSAGE,
  NOT_ORGANIZATION_OWNER_MESSAGE,
  ORGANIZATION_EXISTS_MESSAGE,
  ORGANIZATION_NOT_FOUND_MESSAGE,
  PM_REQUIRED_MESSAGE,
} from './constants/organization.constants';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { Organization } from './entities/organization.entity';
import { OrganizationFactory } from './factories/organization.factory';
import { OrganizationService } from './organization.service';
import { OrganizationPolicy } from './policies/organization.policy';
import { OrganizationRepository } from './repositories/organization.repository';

describe('OrganizationService', () => {
  let service: OrganizationService;

  const repository = {
    findSingleton: jest.fn<Promise<Organization | null>, []>(),
    insert: jest.fn<Promise<Organization>, [Organization]>(),
    update: jest.fn<
      Promise<Organization | null>,
      [string, { name?: string; slug?: string }]
    >(),
    remove: jest.fn<Promise<void>, [string]>(),
  };

  const OWNER_ID = 'user-owner';
  const ownerPm: SessionUser = {
    userId: OWNER_ID,
    role: 'PM',
    name: 'Ada',
    email: 'ada@example.com',
  };
  const otherPm: SessionUser = {
    userId: 'user-other',
    role: 'PM',
    name: 'Grace',
    email: 'grace@example.com',
  };
  const admin: SessionUser = {
    userId: 'user-admin',
    role: 'Admin',
    name: 'Admin',
    email: 'admin@example.com',
  };
  const dev: SessionUser = {
    userId: 'user-dev',
    role: 'Dev',
    name: 'Dev',
    email: 'dev@example.com',
  };

  const organization = (overrides: Partial<Organization> = {}): Organization =>
    new Organization({
      id: 'org-1',
      name: 'Acme Inc',
      slug: 'acme-inc',
      createdByUserId: OWNER_ID,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    });

  const createDto = (): CreateOrganizationDto => {
    const dto = new CreateOrganizationDto();
    dto.name = 'Acme Inc';
    dto.slug = 'acme-inc';
    return dto;
  };

  const updateDto = (
    fields: Partial<UpdateOrganizationDto>,
  ): UpdateOrganizationDto =>
    Object.assign(new UpdateOrganizationDto(), fields);

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationService,
        // Real factory + policy: the wiring and the ABAC rules are the point.
        OrganizationFactory,
        OrganizationPolicy,
        { provide: OrganizationRepository, useValue: repository },
      ],
    }).compile();

    service = module.get<OrganizationService>(OrganizationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('inserts the factory-built entity and returns it (owner recorded)', async () => {
      repository.findSingleton.mockResolvedValue(null);
      const dto = createDto();
      dto.slug = ' ACME-Inc '; // factory normalizes even a pre-cleaned DTO
      const inserted = organization();
      repository.insert.mockResolvedValue(inserted);

      const result = await service.create(dto, ownerPm);

      expect(result).toBe(inserted);
      const built = repository.insert.mock.calls[0][0];
      expect(built.id).toEqual(expect.any(String));
      expect(built.name).toBe('Acme Inc');
      expect(built.slug).toBe('acme-inc');
      expect(built.createdByUserId).toBe(ownerPm.userId);
      expect(built.createdAt).toBe(built.updatedAt);
    });

    it('409 organization_exists when a row already exists', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(service.create(createDto(), ownerPm)).rejects.toMatchObject({
        status: 409,
        response: {
          status: 'organization_exists',
          message: ORGANIZATION_EXISTS_MESSAGE,
        },
      });
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('propagates the repository 409 for the concurrent-create race (23505)', async () => {
      repository.findSingleton.mockResolvedValue(null);
      const conflict = new ConflictException({
        status: 'organization_exists',
        message: ORGANIZATION_EXISTS_MESSAGE,
      });
      repository.insert.mockRejectedValue(conflict);

      await expect(service.create(createDto(), ownerPm)).rejects.toBe(conflict);
    });

    it('403 pm_required for Admin — break-glass covers update/delete only', async () => {
      await expect(service.create(createDto(), admin)).rejects.toMatchObject({
        status: 403,
        response: { status: 'pm_required', message: PM_REQUIRED_MESSAGE },
      });
      expect(repository.findSingleton).not.toHaveBeenCalled();
    });

    it('403 pm_required for Dev', async () => {
      await expect(service.create(createDto(), dev)).rejects.toMatchObject({
        status: 403,
        response: { status: 'pm_required' },
      });
    });
  });

  describe('find', () => {
    it('returns the singleton row', async () => {
      const existing = organization();
      repository.findSingleton.mockResolvedValue(existing);

      await expect(service.find()).resolves.toBe(existing);
    });

    it('returns null when no organization exists', async () => {
      repository.findSingleton.mockResolvedValue(null);

      await expect(service.find()).resolves.toBeNull();
    });
  });

  describe('update', () => {
    it('allows the owner PM and persists the provided fields', async () => {
      const existing = organization();
      const updated = organization();
      repository.findSingleton.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      const result = await service.update(
        updateDto({ name: 'Acme 2' }),
        ownerPm,
      );

      expect(result).toBe(updated);
      expect(repository.update).toHaveBeenCalledWith('org-1', {
        name: 'Acme 2',
      });
    });

    it('allows Admin regardless of ownership', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      repository.update.mockResolvedValue(organization());

      const result = await service.update(
        updateDto({ slug: 'new-slug' }),
        admin,
      );

      expect(result).toBeDefined();
      expect(repository.update).toHaveBeenCalledWith('org-1', {
        slug: 'new-slug',
      });
    });

    it('403 not_organization_owner for a non-owner PM', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(
        service.update(updateDto({ name: 'Nope' }), otherPm),
      ).rejects.toMatchObject({
        status: 403,
        response: {
          status: 'not_organization_owner',
          message: NOT_ORGANIZATION_OWNER_MESSAGE,
        },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('404 organization_not_found when no organization exists', async () => {
      repository.findSingleton.mockResolvedValue(null);

      await expect(
        service.update(updateDto({ name: 'Acme' }), ownerPm),
      ).rejects.toMatchObject({
        status: 404,
        response: {
          status: 'organization_not_found',
          message: ORGANIZATION_NOT_FOUND_MESSAGE,
        },
      });
    });

    it('400 empty_update when no known fields are provided', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(
        service.update(updateDto({}), ownerPm),
      ).rejects.toMatchObject({
        status: 400,
        response: { status: 'empty_update', message: EMPTY_UPDATE_MESSAGE },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('404 when the row vanishes between load and update', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      repository.update.mockResolvedValue(null);

      await expect(
        service.update(updateDto({ name: 'Acme' }), ownerPm),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('hard-deletes for the owner PM', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      repository.remove.mockResolvedValue();

      await service.remove(ownerPm);

      expect(repository.remove).toHaveBeenCalledWith('org-1');
    });

    it('hard-deletes for Admin regardless of ownership', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      repository.remove.mockResolvedValue();

      await service.remove(admin);

      expect(repository.remove).toHaveBeenCalledWith('org-1');
    });

    it('403 not_organization_owner for a non-owner PM', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(service.remove(otherPm)).rejects.toMatchObject({
        status: 403,
        response: { status: 'not_organization_owner' },
      });
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('404 organization_not_found when no organization exists', async () => {
      repository.findSingleton.mockResolvedValue(null);

      await expect(service.remove(ownerPm)).rejects.toMatchObject({
        status: 404,
        response: { status: 'organization_not_found' },
      });
    });
  });
});
