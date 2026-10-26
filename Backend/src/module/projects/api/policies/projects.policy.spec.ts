import { ProjectsPolicy } from './projects.policy';

describe('ProjectsPolicy', () => {
  const policy = new ProjectsPolicy();

  describe('canSee (visibility matrix)', () => {
    it('Admin and HR see everything, membership irrelevant', () => {
      expect(policy.canSee('Admin', false)).toBe(true);
      expect(policy.canSee('HR', false)).toBe(true);
      expect(policy.canSee('Admin', true)).toBe(true);
      expect(policy.canSee('HR', true)).toBe(true);
    });

    it('PM and Dev see only projects they belong to', () => {
      expect(policy.canSee('PM', true)).toBe(true);
      expect(policy.canSee('Dev', true)).toBe(true);
      expect(policy.canSee('PM', false)).toBe(false);
      expect(policy.canSee('Dev', false)).toBe(false);
    });
  });

  describe('canCreate', () => {
    it('Admin and PM only', () => {
      expect(policy.canCreate('Admin')).toBe(true);
      expect(policy.canCreate('PM')).toBe(true);
      expect(policy.canCreate('HR')).toBe(false);
      expect(policy.canCreate('Dev')).toBe(false);
    });
  });

  describe('canManage (update/delete/add/lead)', () => {
    it('Admin manages any project', () => {
      expect(policy.canManage('Admin', true)).toBe(true);
      expect(policy.canManage('Admin', false)).toBe(true);
    });

    it('PM manages only projects they are a member of', () => {
      expect(policy.canManage('PM', true)).toBe(true);
      expect(policy.canManage('PM', false)).toBe(false);
    });

    it('HR and Dev never manage', () => {
      expect(policy.canManage('HR', true)).toBe(false);
      expect(policy.canManage('Dev', true)).toBe(false);
    });
  });

  describe('canRemoveTarget (removal half of the matrix)', () => {
    it('Admin may remove anyone', () => {
      for (const role of ['Admin', 'PM', 'Dev', 'HR'] as const) {
        expect(policy.canRemoveTarget('Admin', role)).toBe(true);
      }
    });

    it('PM may remove Dev targets only', () => {
      expect(policy.canRemoveTarget('PM', 'Dev')).toBe(true);
      expect(policy.canRemoveTarget('PM', 'Admin')).toBe(false);
      expect(policy.canRemoveTarget('PM', 'PM')).toBe(false);
      expect(policy.canRemoveTarget('PM', 'HR')).toBe(false);
    });
  });
});
