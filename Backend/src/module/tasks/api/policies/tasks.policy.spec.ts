import {
  type AssignTargetContext,
  type TaskActorContext,
  TasksPolicy,
} from './tasks.policy';

describe('TasksPolicy', () => {
  const policy = new TasksPolicy();

  const actor = (
    role: TaskActorContext['role'],
    overrides: Partial<TaskActorContext> = {},
  ): TaskActorContext => ({
    role,
    isMember: true,
    isLead: false,
    ...overrides,
  });

  const target = (
    userId: string,
    role: AssignTargetContext['role'],
    isActiveProjectMember = true,
  ): AssignTargetContext => ({ userId, role, isActiveProjectMember });

  describe('canSee (visibility matrix §1.1)', () => {
    it('Admin and HR see every project', () => {
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

  describe('canCreate (mutation matrix §1.1)', () => {
    it('Admin, PM, Lead and member Dev can create; HR cannot', () => {
      expect(policy.canCreate(actor('Admin'))).toBe(true);
      expect(policy.canCreate(actor('PM'))).toBe(true);
      expect(policy.canCreate(actor('Dev', { isLead: true }))).toBe(true);
      expect(policy.canCreate(actor('Dev'))).toBe(true);
      expect(policy.canCreate(actor('HR'))).toBe(false);
    });
  });

  describe('canManage (edit/delete/assign — full actors)', () => {
    it('Admin manages any project, membership irrelevant', () => {
      expect(policy.canManage(actor('Admin', { isMember: false }))).toBe(true);
      expect(policy.canManage(actor('Admin'))).toBe(true);
    });

    it('PM and project Lead manage only while members', () => {
      expect(policy.canManage(actor('PM'))).toBe(true);
      expect(policy.canManage(actor('Dev', { isLead: true }))).toBe(true);
      expect(policy.canManage(actor('PM', { isMember: false }))).toBe(false);
      expect(
        policy.canManage(actor('Dev', { isLead: true, isMember: false })),
      ).toBe(false);
    });

    it('HR and plain Devs never manage', () => {
      expect(policy.canManage(actor('HR'))).toBe(false);
      expect(policy.canManage(actor('Dev'))).toBe(false);
      expect(policy.canManage(actor('HR', { isMember: false }))).toBe(false);
    });
  });

  describe('canMoveStatus (full actors OR the assignee)', () => {
    const me = 'user-1';

    it('full actors can move any task', () => {
      expect(policy.canMoveStatus(actor('Admin'), 'someone-else', me)).toBe(
        true,
      );
      expect(policy.canMoveStatus(actor('PM'), 'someone-else', me)).toBe(true);
      expect(
        policy.canMoveStatus(actor('Dev', { isLead: true }), 'other', me),
      ).toBe(true);
    });

    it('a non-full actor moves only their own task', () => {
      expect(policy.canMoveStatus(actor('Dev'), me, me)).toBe(true);
      expect(policy.canMoveStatus(actor('Dev'), 'someone-else', me)).toBe(
        false,
      );
      // Unassigned task: nobody non-full may move it.
      expect(policy.canMoveStatus(actor('Dev'), null, me)).toBe(false);
      expect(policy.canMoveStatus(actor('HR'), me, me)).toBe(false);
    });
  });

  describe('canAssignTarget (assignment matrix §1.2)', () => {
    const admin = actor('Admin');
    const pm = actor('PM');
    const lead = actor('Dev', { isLead: true });
    const dev = actor('Dev');
    const me = 'user-1';

    it('Admin targets Dev, PM or Admin project members — never HR', () => {
      expect(policy.canAssignTarget(admin, me, target('x', 'Dev'))).toBe(true);
      expect(policy.canAssignTarget(admin, me, target('x', 'PM'))).toBe(true);
      expect(policy.canAssignTarget(admin, me, target('x', 'Admin'))).toBe(
        true,
      );
      expect(policy.canAssignTarget(admin, me, target('x', 'HR'))).toBe(false);
    });

    it('Admin self-assign is a valid target (silent 200 — edge 14)', () => {
      expect(policy.canAssignTarget(admin, me, target(me, 'Admin'))).toBe(true);
    });

    it('PM targets Dev members only (PM/Lead targets rejected — edges 9–10)', () => {
      expect(policy.canAssignTarget(pm, me, target('x', 'Dev'))).toBe(true);
      expect(policy.canAssignTarget(pm, me, target('x', 'PM'))).toBe(false);
      expect(policy.canAssignTarget(pm, me, target('x', 'Admin'))).toBe(false);
      expect(policy.canAssignTarget(pm, me, target('x', 'HR'))).toBe(false);
      expect(policy.canAssignTarget(lead, me, target('x', 'PM'))).toBe(false);
      expect(policy.canAssignTarget(lead, me, target('x', 'Dev'))).toBe(true);
    });

    it('Lead self-assign (a Dev target) is admitted — edge 14', () => {
      expect(policy.canAssignTarget(lead, me, target(me, 'Dev'))).toBe(true);
    });

    it('a plain Dev targets only themselves (their create)', () => {
      expect(policy.canAssignTarget(dev, me, target(me, 'Dev'))).toBe(true);
      expect(
        policy.canAssignTarget(dev, me, target('someone-else', 'Dev')),
      ).toBe(false);
    });

    it('rejects targets that are not ACTIVE project members — edge 12', () => {
      expect(policy.canAssignTarget(admin, me, target('x', 'Dev', false))).toBe(
        false,
      );
      expect(policy.canAssignTarget(pm, me, target('x', 'Dev', false))).toBe(
        false,
      );
    });

    it('non-members have no assignment rights at all', () => {
      const stranger = actor('PM', { isMember: false });
      expect(policy.canAssignTarget(stranger, me, target('x', 'Dev'))).toBe(
        false,
      );
      expect(
        policy.canAssignTarget(
          actor('Dev', { isLead: true, isMember: false }),
          me,
          target('x', 'Dev'),
        ),
      ).toBe(false);
    });
  });
});
