import { ROLES, type Role } from '../../../auth/api/constants/auth.constants';
import { MembersPolicy } from './members.policy';

describe('MembersPolicy', () => {
  const policy = new MembersPolicy();

  describe('canInviteRole (§1.1 matrix)', () => {
    it.each(ROLES)('Admin may invite any role (%s)', (role) => {
      expect(policy.canInviteRole('Admin', role)).toBe(true);
    });

    it('HR may invite PM, Dev and a peer HR — never Admin', () => {
      expect(policy.canInviteRole('HR', 'PM')).toBe(true);
      expect(policy.canInviteRole('HR', 'Dev')).toBe(true);
      expect(policy.canInviteRole('HR', 'HR')).toBe(true);
      expect(policy.canInviteRole('HR', 'Admin')).toBe(false);
    });

    it('PM may invite a peer PM and Dev — never HR or Admin', () => {
      expect(policy.canInviteRole('PM', 'PM')).toBe(true);
      expect(policy.canInviteRole('PM', 'Dev')).toBe(true);
      expect(policy.canInviteRole('PM', 'HR')).toBe(false);
      expect(policy.canInviteRole('PM', 'Admin')).toBe(false);
    });

    it('Dev may invite nobody (read-only role)', () => {
      for (const role of ROLES) {
        expect(policy.canInviteRole('Dev', role)).toBe(false);
      }
    });
  });

  describe('canManageRole (§1.1 matrix)', () => {
    it.each(ROLES)(
      'Admin may manage anyone, including peer Admins (%s)',
      (role) => {
        expect(policy.canManageRole('Admin', role)).toBe(true);
      },
    );

    it('HR may manage PM and Dev — never another HR, never Admin', () => {
      expect(policy.canManageRole('HR', 'PM')).toBe(true);
      expect(policy.canManageRole('HR', 'Dev')).toBe(true);
      expect(policy.canManageRole('HR', 'HR')).toBe(false);
      expect(policy.canManageRole('HR', 'Admin')).toBe(false);
    });

    it('PM may manage Dev only — never another PM, never HR/Admin', () => {
      expect(policy.canManageRole('PM', 'Dev')).toBe(true);
      expect(policy.canManageRole('PM', 'PM')).toBe(false);
      expect(policy.canManageRole('PM', 'HR')).toBe(false);
      expect(policy.canManageRole('PM', 'Admin')).toBe(false);
    });

    it('Dev may manage nobody', () => {
      for (const role of ROLES) {
        expect(policy.canManageRole('Dev', role)).toBe(false);
      }
    });
  });

  describe('canRemove', () => {
    it('mirrors canManageRole for every actor/target pair', () => {
      for (const actor of ROLES as readonly Role[]) {
        for (const target of ROLES as readonly Role[]) {
          expect(policy.canRemove(actor, target)).toBe(
            policy.canManageRole(actor, target),
          );
        }
      }
    });
  });
});
