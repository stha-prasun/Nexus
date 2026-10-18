import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ROLES } from '../../auth/api/constants/auth.constants';
import type { SessionUser } from '../../auth/api/session/session.types';
import { NOT_ACTIVE_MEMBER_MESSAGE } from '../../members/api/constants/members.constants';
import { MembersRepository } from '../../members/api/repositories/members.repository';
import {
  ADMIN_REQUIRED_MESSAGE,
  EMPTY_UPDATE_MESSAGE,
  NOT_ORGANIZATION_OWNER_MESSAGE,
  ORGANIZATION_EXISTS_MESSAGE,
  ORGANIZATION_NOT_FOUND_MESSAGE,
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
    insertWithMembership: jest.fn<
      Promise<Organization>,
      [Organization, string]
    >(),
    update: jest.fn<
      Promise<Organization | null>,
      [string, { name?: string; slug?: string }]
    >(),
    remove: jest.fn<Promise<void>, [string]>(),
  };

  const membersRepository = {
    findActiveMembershipOrg: jest.fn<
      Promise<{ id: string; name: string } | null>,
      [string]
    >(),
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
  const hr: SessionUser = {
    userId: 'user-hr',
    role: 'HR',
    name: 'Hana',
    email: 'hana@example.com',
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
    // Default: every actor holds an ACTIVE membership (individual tests
    // override this to exercise the gating).
    membersRepository.findActiveMembershipOrg.mockResolvedValue({
      id: 'org-1',
      name: 'Acme Inc',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationService,
        // Real factory + policy: the wiring and the ABAC rules are the point.
        OrganizationFactory,
        OrganizationPolicy,
        { provide: OrganizationRepository, useValue: repository },
        { provide: MembersRepository, useValue: membersRepository },
      ],
    }).compile();

    service = module.get<OrganizationService>(OrganizationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('inserts the factory-built entity with the creator id (bootstrap membership) and returns it', async () => {
      repository.findSingleton.mockResolvedValue(null);
      const dto = createDto();
      dto.slug = ' ACME-Inc '; // factory normalizes even a pre-cleaned DTO
      const inserted = organization();
      repository.insertWithMembership.mockResolvedValue(inserted);

      const result = await service.create(dto, admin);

      expect(result).toBe(inserted);
      const [built, creatorUserId] = repository.insertWithMembership.mock
        .calls[0] as [Organization, string];
      expect(built.id).toEqual(expect.any(String));
      expect(built.name).toBe('Acme Inc');
      expect(built.slug).toBe('acme-inc');
      expect(built.createdByUserId).toBe(admin.userId);
      expect(built.createdAt).toBe(built.updatedAt);
      // The membership is bootstrapped for the creator in the same tx.
      expect(creatorUserId).toBe(admin.userId);
    });

    it('409 organization_exists when a row already exists', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(service.create(createDto(), admin)).rejects.toMatchObject({
        status: 409,
        response: {
          status: 'organization_exists',
          message: ORGANIZATION_EXISTS_MESSAGE,
        },
      });
      expect(repository.insertWithMembership).not.toHaveBeenCalled();
    });

    it('propagates the repository 409 for the concurrent-create race (23505)', async () => {
      repository.findSingleton.mockResolvedValue(null);
      const conflict = new ConflictException({
        status: 'organization_exists',
        message: ORGANIZATION_EXISTS_MESSAGE,
      });
      repository.insertWithMembership.mockRejectedValue(conflict);

      await expect(service.create(createDto(), admin)).rejects.toBe(conflict);
    });

    it.each([
      ['PM', ownerPm],
      ['HR', hr],
      ['Dev', dev],
    ] as const)(
      '403 admin_required for %s — create is Admin-only',
      async (_role, actor) => {
        await expect(service.create(createDto(), actor)).rejects.toMatchObject({
          status: 403,
          response: {
            status: 'admin_required',
            message: ADMIN_REQUIRED_MESSAGE,
          },
        });
        expect(repository.findSingleton).not.toHaveBeenCalled();
      },
    );
  });

  describe('find', () => {
    it('returns the singleton row for an ACTIVE member', async () => {
      const existing = organization();
      repository.findSingleton.mockResolvedValue(existing);
      membersRepository.findActiveMembershipOrg.mockResolvedValue({
        id: 'org-1',
        name: 'Acme Inc',
      });

      await expect(service.find(admin)).resolves.toBe(existing);
      expect(membersRepository.findActiveMembershipOrg).toHaveBeenCalledWith(
        admin.userId,
      );
    });

    it('returns null when no organization exists (membership never consulted)', async () => {
      repository.findSingleton.mockResolvedValue(null);

      await expect(service.find(admin)).resolves.toBeNull();
      expect(membersRepository.findActiveMembershipOrg).not.toHaveBeenCalled();
    });

    it('returns null for a signed-in user without an ACTIVE membership (removed member)', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      membersRepository.findActiveMembershipOrg.mockResolvedValue(null);

      await expect(service.find(dev)).resolves.toBeNull();
    });
  });

  describe('update', () => {
    it('allows Admin and persists the provided fields', async () => {
      const existing = organization();
      const updated = organization();
      repository.findSingleton.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      const result = await service.update(updateDto({ name: 'Acme 2' }), admin);

      expect(result).toBe(updated);
      expect(repository.update).toHaveBeenCalledWith('org-1', {
        name: 'Acme 2',
      });
    });

    it('allows Admin even when another user created the row', async () => {
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

    it('403 not_organization_owner for a PM — even the owner (Admin manages alone)', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(
        service.update(updateDto({ name: 'Nope' }), ownerPm),
      ).rejects.toMatchObject({
        status: 403,
        response: {
          status: 'not_organization_owner',
          message: NOT_ORGANIZATION_OWNER_MESSAGE,
        },
      });
      expect(repository.update).not.toHaveBeenCalled();
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

    it('403 not_organization_owner for HR and Dev', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(
        service.update(updateDto({ name: 'Nope' }), hr),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.update(updateDto({ name: 'Nope' }), dev),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('404 organization_not_found when no organization exists', async () => {
      repository.findSingleton.mockResolvedValue(null);

      await expect(
        service.update(updateDto({ name: 'Acme' }), admin),
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

      await expect(service.update(updateDto({}), admin)).rejects.toMatchObject({
        status: 400,
        response: { status: 'empty_update', message: EMPTY_UPDATE_MESSAGE },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('404 when the row vanishes between load and update', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      repository.update.mockResolvedValue(null);

      await expect(
        service.update(updateDto({ name: 'Acme' }), admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('403 not_active_member for an Admin without an ACTIVE membership (stale role)', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      membersRepository.findActiveMembershipOrg.mockResolvedValue(null);

      await expect(
        service.update(updateDto({ name: 'Nope' }), admin),
      ).rejects.toMatchObject({
        status: 403,
        response: {
          status: 'not_active_member',
          message: NOT_ACTIVE_MEMBER_MESSAGE,
        },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('hard-deletes for Admin', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      repository.remove.mockResolvedValue();

      await service.remove(admin);

      expect(repository.remove).toHaveBeenCalledWith('org-1');
    });

    it('403 not_organization_owner for a PM — even the owner (Admin manages alone)', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(service.remove(ownerPm)).rejects.toMatchObject({
        status: 403,
        response: { status: 'not_organization_owner' },
      });
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('403 not_organization_owner for a non-owner PM, HR and Dev', async () => {
      repository.findSingleton.mockResolvedValue(organization());

      await expect(service.remove(otherPm)).rejects.toMatchObject({
        status: 403,
        response: { status: 'not_organization_owner' },
      });
      await expect(service.remove(hr)).rejects.toMatchObject({ status: 403 });
      await expect(service.remove(dev)).rejects.toMatchObject({ status: 403 });
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('404 organization_not_found when no organization exists', async () => {
      repository.findSingleton.mockResolvedValue(null);

      await expect(service.remove(admin)).rejects.toMatchObject({
        status: 404,
        response: { status: 'organization_not_found' },
      });
    });

    it('403 not_active_member for an Admin without an ACTIVE membership (stale role)', async () => {
      repository.findSingleton.mockResolvedValue(organization());
      membersRepository.findActiveMembershipOrg.mockResolvedValue(null);

      await expect(service.remove(admin)).rejects.toMatchObject({
        status: 403,
        response: { status: 'not_active_member' },
      });
      expect(repository.remove).not.toHaveBeenCalled();
    });
  });

  describe('role constants consistency', () => {
    it("'HR' and 'Admin' are in ROLES (append-only domain)", () => {
      expect(ROLES).toContain('HR');
      expect(ROLES).toContain('Admin');
    });
  });
});
