import { type DocumentActorContext, DocumentsPolicy } from './documents.policy';

type Case = {
  label: string;
  role: DocumentActorContext['role'];
  isMember: boolean;
  isLead?: boolean;
  see: boolean;
  manage: boolean;
};

/**
 * The full §1 matrix as data — one row per actor shape. `see: false`
 * implies the service answers 404 before `canManage` is ever consulted;
 * `manage: false` with `see: true` is the 403 `role_forbidden` path.
 */
const MATRIX: Case[] = [
  {
    label: 'Admin, not a member',
    role: 'Admin',
    isMember: false,
    see: true,
    manage: true,
  },
  {
    label: 'Admin, member',
    role: 'Admin',
    isMember: true,
    see: true,
    manage: true,
  },
  {
    label: 'HR, not a member',
    role: 'HR',
    isMember: false,
    see: true,
    manage: false,
  },
  {
    label: 'HR, member',
    role: 'HR',
    isMember: true,
    see: true,
    manage: false,
  },
  {
    label: 'PM, member',
    role: 'PM',
    isMember: true,
    see: true,
    manage: true,
  },
  {
    label: 'PM, not a member',
    role: 'PM',
    isMember: false,
    see: false,
    manage: false,
  },
  {
    label: 'Lead Dev, member',
    role: 'Dev',
    isMember: true,
    isLead: true,
    see: true,
    manage: true,
  },
  {
    label: 'Lead Dev, not a member',
    role: 'Dev',
    isMember: false,
    isLead: true,
    see: false,
    manage: false,
  },
  {
    label: 'plain Dev, member',
    role: 'Dev',
    isMember: true,
    see: true,
    manage: false,
  },
  {
    label: 'plain Dev, not a member',
    role: 'Dev',
    isMember: false,
    see: false,
    manage: false,
  },
];

describe('DocumentsPolicy', () => {
  const policy = new DocumentsPolicy();

  const context = (testCase: Case): DocumentActorContext => ({
    role: testCase.role,
    isMember: testCase.isMember,
    isLead: testCase.isLead ?? false,
  });

  describe('permission matrix (plan §1)', () => {
    it.each(MATRIX)('$label — see=$see manage=$manage', (testCase) => {
      expect(policy.canSee(testCase.role, testCase.isMember)).toBe(
        testCase.see,
      );
      expect(policy.canManage(context(testCase))).toBe(testCase.manage);
    });
  });

  describe('canSee', () => {
    it('Admin and HR see every project regardless of membership', () => {
      for (const role of ['Admin', 'HR'] as const) {
        expect(policy.canSee(role, true)).toBe(true);
        expect(policy.canSee(role, false)).toBe(true);
      }
    });

    it('PM and Dev see only projects they belong to', () => {
      expect(policy.canSee('PM', true)).toBe(true);
      expect(policy.canSee('Dev', true)).toBe(true);
      expect(policy.canSee('PM', false)).toBe(false);
      expect(policy.canSee('Dev', false)).toBe(false);
    });
  });

  describe('canManage (upload / delete)', () => {
    it('Admin manages any project, membership irrelevant', () => {
      expect(
        policy.canManage({ role: 'Admin', isMember: false, isLead: false }),
      ).toBe(true);
      expect(
        policy.canManage({ role: 'Admin', isMember: true, isLead: false }),
      ).toBe(true);
    });

    it('PM and project Lead manage only while members', () => {
      expect(
        policy.canManage({ role: 'PM', isMember: true, isLead: false }),
      ).toBe(true);
      expect(
        policy.canManage({ role: 'Dev', isMember: true, isLead: true }),
      ).toBe(true);
      expect(
        policy.canManage({ role: 'PM', isMember: false, isLead: false }),
      ).toBe(false);
      expect(
        policy.canManage({ role: 'Dev', isMember: false, isLead: true }),
      ).toBe(false);
    });

    it('HR and plain Devs never manage', () => {
      expect(
        policy.canManage({ role: 'HR', isMember: true, isLead: false }),
      ).toBe(false);
      expect(
        policy.canManage({ role: 'Dev', isMember: true, isLead: false }),
      ).toBe(false);
      expect(
        policy.canManage({ role: 'HR', isMember: false, isLead: false }),
      ).toBe(false);
    });

    it('a non-member is never manageable (404 path precedes this check)', () => {
      for (const role of ['Admin', 'HR', 'PM', 'Dev'] as const) {
        if (role === 'Admin') continue; // Admin is the documented exception
        expect(policy.canManage({ role, isMember: false, isLead: false })).toBe(
          false,
        );
      }
    });
  });
});
