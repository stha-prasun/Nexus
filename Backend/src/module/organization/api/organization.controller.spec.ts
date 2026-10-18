import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { SessionService } from '../../auth/api/session/session.service';
import { ActiveMemberGuard } from '../../members/api/guards/active-member.guard';
import { MembersRepository } from '../../members/api/repositories/members.repository';
import { Organization } from './entities/organization.entity';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

describe('OrganizationController', () => {
  let controller: OrganizationController;

  // @nestjs/throttler v6 (not re-exported from the package root): the
  // @Throttle decorator stores limit/ttl under 'THROTTLER:{LIMIT|TTL}' + tracker name.
  const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';
  const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';

  const organizationService = {
    create: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const OWNER_ID = 'user-owner';
  const organization = new Organization({
    id: 'org-1',
    name: 'Acme Inc',
    slug: 'acme-inc',
    createdByUserId: OWNER_ID,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });

  const request = (): AuthenticatedRequest =>
    ({
      user: {
        userId: OWNER_ID,
        role: 'Admin',
        name: 'Ada',
        email: 'ada@example.com',
      },
    }) as unknown as AuthenticatedRequest;

  const handler = (name: keyof OrganizationController): Handler =>
    (OrganizationController.prototype as unknown as Record<string, Handler>)[
      name
    ];

  type Handler = (...args: never[]) => unknown;

  const guardsOf = (target: Handler): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

  const rolesOf = (target: Handler): unknown =>
    Reflect.getMetadata(ROLES_KEY, target);

  const response = (
    id: string,
    name = 'Acme Inc',
    slug = 'acme-inc',
  ): Record<string, unknown> => ({
    id,
    name,
    slug,
    createdByUserId: OWNER_ID,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        { provide: OrganizationService, useValue: organizationService },
        // Nest instantiates the @UseGuards classes on the controller, so
        // SessionAuthGuard's and ActiveMemberGuard's dependencies must be
        // resolvable here.
        { provide: SessionService, useValue: {} },
        { provide: MembersRepository, useValue: {} },
      ],
    }).compile();

    controller = module.get<OrganizationController>(OrganizationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('guard composition', () => {
    it('POST requires session + roles (Admin) + ActiveMemberGuard and is throttled 5/10min', () => {
      const target = handler('create');

      expect(guardsOf(target)).toEqual([
        SessionAuthGuard,
        RolesGuard,
        ActiveMemberGuard,
      ]);
      expect(rolesOf(target)).toEqual(['Admin']);
      expect(Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, target)).toBe(5);
      expect(Reflect.getMetadata(THROTTLER_TTL_DEFAULT, target)).toBe(600_000);
    });

    it('GET requires session only — no role gate, no ActiveMemberGuard (null body instead of 403)', () => {
      const target = handler('find');

      expect(guardsOf(target)).toEqual([SessionAuthGuard]);
      expect(rolesOf(target)).toBeUndefined();
    });

    it('PATCH and DELETE require session + roles (Admin) + ActiveMemberGuard; DELETE answers 204', () => {
      expect(guardsOf(handler('update'))).toEqual([
        SessionAuthGuard,
        RolesGuard,
        ActiveMemberGuard,
      ]);
      expect(rolesOf(handler('update'))).toEqual(['Admin']);

      expect(guardsOf(handler('remove'))).toEqual([
        SessionAuthGuard,
        RolesGuard,
        ActiveMemberGuard,
      ]);
      expect(rolesOf(handler('remove'))).toEqual(['Admin']);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('remove'))).toBe(
        204,
      );
    });
  });

  describe('create', () => {
    it('delegates with the session user and returns the mapped DTO', async () => {
      organizationService.create.mockResolvedValue(organization);

      const result = await controller.create(
        { name: 'Acme Inc', slug: 'acme-inc' } as never,
        request(),
      );

      expect(organizationService.create).toHaveBeenCalledWith(
        { name: 'Acme Inc', slug: 'acme-inc' },
        request().user,
      );
      expect(result).toEqual(response('org-1'));
    });
  });

  describe('find', () => {
    it('wraps the organization in the response envelope (delegating the session user)', async () => {
      organizationService.find.mockResolvedValue(organization);

      await expect(controller.find(request())).resolves.toEqual({
        organization: response('org-1'),
      });
      expect(organizationService.find).toHaveBeenCalledWith(request().user);
    });

    it('answers a null body when no organization exists or the caller is not a member', async () => {
      organizationService.find.mockResolvedValue(null);

      await expect(controller.find(request())).resolves.toEqual({
        organization: null,
      });
    });
  });

  describe('update', () => {
    it('delegates with the session user and returns the mapped DTO', async () => {
      const updated = new Organization({
        id: 'org-1',
        name: 'Acme 2',
        slug: 'acme-inc',
        createdByUserId: OWNER_ID,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
      });
      organizationService.update.mockResolvedValue(updated);

      const result = await controller.update(
        { name: 'Acme 2' } as never,
        request(),
      );

      expect(organizationService.update).toHaveBeenCalledWith(
        { name: 'Acme 2' },
        request().user,
      );
      expect(result).toEqual(response('org-1', 'Acme 2'));
    });
  });

  describe('remove', () => {
    it('delegates with the session user and returns nothing (204)', async () => {
      organizationService.remove.mockResolvedValue(undefined);

      await expect(controller.remove(request())).resolves.toBeUndefined();

      expect(organizationService.remove).toHaveBeenCalledWith(request().user);
    });
  });
});
