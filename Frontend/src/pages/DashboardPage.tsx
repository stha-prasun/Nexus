import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useDialog } from '@/components/dashboard/AppDialog';
import { AppShell } from '@/components/dashboard/AppShell';
import { EmptyOrgView } from '@/components/dashboard/EmptyOrgView';
import { NoOrgView } from '@/components/dashboard/NoOrgView';
import { OrgView, RolePicker } from '@/components/dashboard/OrgView';
import { useToast } from '@/components/dashboard/Toast';
import {
  ApiError,
  changeMemberRole,
  createOrganization,
  deleteOrganization,
  inviteMember,
  logout,
  removeMember,
  updateOrganization,
} from '@/lib/api';
import type { DashboardState, Member, Org, RoleKey } from '@/lib/dashboard';
import {
  accessSummary,
  CURRENT_USER,
  createDemoState,
  displayMember,
  EMAIL_PATTERN,
  INPUT,
  invitableRoles,
  ROLES,
  SLUG_PATTERN,
  slugify,
  toApiRole,
  toRoleKey,
} from '@/lib/dashboard';
import {
  useAppDispatch,
  useAppSelector,
  useMembers,
  useOrganization,
} from '@/store/hooks';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearMembers } from '@/store/slices/membersSlice';
import { clearOrg, removeOrg, setOrg } from '@/store/slices/orgSlice';

function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block font-semibold text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Controlled body for the edit-organization dialog: the slug follows the
 * name (via slugify) until the URL field is edited — same rule as the
 * create form in EmptyOrgView. Inputs keep their `name` attributes so the
 * dialog's FormData submit path is unchanged.
 */
function EditOrgFields({
  initialName,
  initialSlug,
}: {
  initialName: string;
  initialSlug: string;
}) {
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <>
      <Field htmlFor="e-name" label="Name">
        <input
          id="e-name"
          name="name"
          value={name}
          onChange={(event) => {
            const value = event.target.value;
            setName(value);
            if (!slugTouched) setSlug(slugify(value));
          }}
          className={INPUT}
        />
      </Field>
      <Field htmlFor="e-slug" label="URL">
        <input
          id="e-slug"
          name="slug"
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(
              event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
            );
          }}
          className={INPUT}
        />
      </Field>
    </>
  );
}

export function DashboardPage() {
  const [state, setState] = useState<DashboardState>(createDemoState);
  const [viewKey, setViewKey] = useState(0);
  const { show, element: toastElement } = useToast();
  const { ask, element: dialogElement } = useDialog();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const authUser = useAppSelector((session) => session.auth.user);
  const {
    org,
    status: orgStatus,
    error: orgError,
    retry: retryOrg,
    refresh: refreshOrg,
  } = useOrganization();
  const {
    members: roster,
    status: membersStatus,
    error: membersError,
    retry: retryMembers,
    refresh: refreshRoster,
  } = useMembers();

  /** Real roster once loaded; the demo list only backstops the no-org views. */
  const displayMembers: Member[] =
    membersStatus === 'ready' ? roster.map(displayMember) : [];
  const rowAt = (index: number) => roster[index];

  /** This device only — "log out everywhere" lives on the profile page. */
  const handleLogout = (): void => {
    void (async () => {
      try {
        await logout();
      } catch {
        // Best-effort server-side invalidation; the cookie still dies at TTL.
      }
      dispatch(clearMembers());
      dispatch(clearOrg());
      dispatch(setAnonymous());
      navigate('/', { replace: true });
    })();
  };

  /**
   * "Check again" from NoOrgView: a fresh GET. A found organization flips
   * the store and this page swaps to OrgView on its own; still-null and
   * errors are surfaced as toasts.
   */
  const handleCheckAgain = async (): Promise<void> => {
    try {
      const organization = await refreshOrg();
      if (organization === null) {
        show(
          `Still no organization. Ask your Admin to add ${authUser?.email ?? 'your email'}.`,
        );
      }
    } catch (error) {
      show(
        error instanceof ApiError
          ? error.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const { projects } = state;
  // Real session role drives gating — the demo `viewAs` state no longer does.
  const roleKey: RoleKey = authUser ? toRoleKey(authUser.role) : 'pm';
  const canManageOrg = authUser?.role === 'Admin';
  const canManageMembers =
    authUser != null && ['Admin', 'HR', 'PM'].includes(authUser.role);

  useEffect(() => {
    document.title = org
      ? `${org.name} · Nexus`
      : canManageOrg
        ? 'Create organization · Nexus'
        : 'Organization · Nexus';
  }, [org, canManageOrg]);

  const bumpGraph = (): void => setViewKey((key) => key + 1);

  const handleAddMember = async (): Promise<void> => {
    // §1.1 matrix: the picker only offers roles this actor may invite.
    const allowed = invitableRoles(roleKey);
    const result = await ask({
      title: 'Add a member',
      ok: 'Add member',
      body: (
        <>
          <Field htmlFor="m-email" label="Email">
            <input
              id="m-email"
              name="email"
              type="email"
              placeholder="teammate@company.com"
              className={INPUT}
            />
          </Field>
          <div>
            <span className="mb-1.5 block font-semibold text-ink">Role</span>
            <RolePicker roles={allowed} />
            <p className="mt-2 text-[13px] text-ink-soft">
              {accessSummary(roleKey)}
            </p>
          </div>
        </>
      ),
      validate: (data) => {
        const email = String(data.get('email') ?? '')
          .trim()
          .toLowerCase();
        if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
        if (displayMembers.some((member) => member.email === email))
          return 'That person is already a member.';
        const role = String(data.get('role') ?? '') as RoleKey;
        if (!allowed.includes(role)) return 'You cannot invite that role.';
        return '';
      },
    });
    if (!result) return;
    const email = String(result.get('email') ?? '')
      .trim()
      .toLowerCase();
    const role = result.get('role') as RoleKey;
    try {
      const { message } = await inviteMember({
        email,
        role: toApiRole(role),
      });
      await refreshRoster();
      bumpGraph();
      // Server message covers both "sent" and "re-invited (new link)".
      show(message);
    } catch (error) {
      show(
        error instanceof ApiError
          ? error.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const handleRemoveMember = async (index: number): Promise<void> => {
    const member = displayMembers[index];
    const row = rowAt(index);
    if (!member || !row || !org) return;
    const result = await ask({
      title: `Remove ${member.name}?`,
      ok: 'Remove',
      danger: true,
      body: (
        <p>
          {member.name} will lose access to {org.name} and be taken off all its
          projects.
        </p>
      ),
    });
    if (!result) return;
    try {
      await removeMember(row.id);
      await refreshRoster();
      bumpGraph();
      show(`${member.name} removed`);
    } catch (error) {
      show(
        error instanceof ApiError
          ? error.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const handleRoleChange = (index: number, role: RoleKey): void => {
    const row = rowAt(index);
    if (!row) return;
    void (async () => {
      let changed = false;
      try {
        await changeMemberRole(row.id, toApiRole(role));
        changed = true;
      } catch (error) {
        show(
          error instanceof ApiError
            ? error.messages.join(' ')
            : 'Something went wrong. Please try again.',
        );
      }
      // Revalidate either way: on failure the roster reverts the optimistic
      // select, on success it picks up the server's authoritative role.
      try {
        await refreshRoster();
        bumpGraph();
      } catch {
        // Already surfaced above (or the list keeps its previous truth).
      }
      if (changed) show('Role updated');
    })();
  };

  const handleEditOrg = async (): Promise<void> => {
    if (!org) return;
    const result = await ask({
      title: 'Edit organization',
      ok: 'Save changes',
      body: <EditOrgFields initialName={org.name} initialSlug={org.slug} />,
      validate: (data) => {
        const name = String(data.get('name') ?? '').trim();
        const slug = String(data.get('slug') ?? '');
        if (name.length < 2) return 'Give your organization a name.';
        if (!SLUG_PATTERN.test(slug) || slug.length < 3)
          return 'The URL needs 3+ lowercase letters or numbers, with hyphens between words.';
        return '';
      },
    });
    if (!result) return;
    const name = String(result.get('name') ?? '').trim();
    const slug = String(result.get('slug') ?? '');
    try {
      const updated = await updateOrganization({ name, slug });
      dispatch(setOrg(updated));
      show('Organization updated');
    } catch (error) {
      // 404 = deleted in another tab — fall back to the empty state.
      if (error instanceof ApiError && error.status === 404) {
        dispatch(removeOrg());
      }
      show(
        error instanceof ApiError
          ? error.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const handleDeleteOrg = async (): Promise<void> => {
    if (!org) return;
    const name = org.name;
    const result = await ask({
      title: 'Delete organization',
      ok: 'Delete forever',
      danger: true,
      body: (
        <>
          <p className="border-l-4 border-red-600 bg-red-50 px-3 py-2 font-semibold text-red-800">
            Sensitive action. There is no way to recover a deleted organization.
          </p>
          <p>
            This permanently deletes{' '}
            <strong className="text-ink">{name}</strong>, all of its projects
            and every task. This can&apos;t be undone.
          </p>
          <Field
            htmlFor="d-confirm"
            label="Type the organization name to confirm"
          >
            <input
              id="d-confirm"
              name="confirm"
              autoComplete="off"
              placeholder={name}
              className={INPUT}
            />
          </Field>
        </>
      ),
      validate: (data) =>
        String(data.get('confirm') ?? '').trim() === name
          ? ''
          : "The name doesn't match.",
    });
    if (!result) return;
    try {
      await deleteOrganization();
    } catch (error) {
      // Already gone elsewhere — treat as deleted so the UI converges.
      if (!(error instanceof ApiError && error.status === 404)) {
        show(
          error instanceof ApiError
            ? error.messages.join(' ')
            : 'Something went wrong. Please try again.',
        );
        return;
      }
    }
    dispatch(removeOrg());
    dispatch(clearMembers());
    setState((current) => ({
      ...current,
      projects: [],
    }));
    show('Organization deleted');
  };

  /**
   * POSTs the real singleton; ApiError propagates so EmptyOrgView can show
   * it inline (409 race, 403 role_forbidden, 429 throttle, 400 validation).
   */
  const handleCreateOrg = async (created: Org): Promise<void> => {
    const organization = await createOrganization(created);
    dispatch(setOrg(organization));
    // The roster was never fetchable pre-org — prime a fresh load.
    dispatch(clearMembers());
    setState((current) => ({
      ...current,
      viewAs: 'admin',
      members: [
        authUser
          ? { name: authUser.name, email: authUser.email, role: 'admin' }
          : { ...(current.members[0] ?? { ...CURRENT_USER }), role: 'admin' },
      ],
      projects: [],
    }));
    bumpGraph();
    show('Organization created. Add your first members.');
  };

  const crumb = org ? (
    <>
      <span>{org.name}</span>
      <span className="mx-1.5 text-ink-line">/</span>
      <span className="font-semibold text-ink">Organization</span>
    </>
  ) : (
    <span className="font-semibold text-ink">Organization</span>
  );

  return (
    <AppShell
      org={org}
      user={{
        name: authUser?.name ?? CURRENT_USER.name,
        email: authUser?.email ?? CURRENT_USER.email,
        roleLabel: authUser
          ? ROLES[toRoleKey(authUser.role)].label
          : 'No role yet',
      }}
      crumb={crumb}
      onLogout={handleLogout}
    >
      {/* The empty state carries its own staggered `.rise` entrance (per the
          design), so `view-in` only wraps the org view. */}
      <div
        key={org ? `org-${viewKey}` : 'empty'}
        className={org ? 'view-in' : undefined}
      >
        {orgStatus === 'unknown' || orgStatus === 'loading' ? (
          <div
            role="status"
            aria-label="Loading organization"
            className="flex justify-center py-24"
          >
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt" />
          </div>
        ) : orgStatus === 'error' ? (
          <div className="flex flex-col items-center gap-4 py-24 text-center">
            <p className="text-[15px] font-semibold text-ink">
              Couldn&apos;t load your organization.
            </p>
            <p className="max-w-sm text-sm text-ink-soft">
              {orgError.join(' ')}
            </p>
            <button
              type="button"
              onClick={retryOrg}
              className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2"
            >
              Retry
            </button>
          </div>
        ) : org ? (
          membersStatus === 'error' && displayMembers.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-24 text-center">
              <p className="text-[15px] font-semibold text-ink">
                Couldn&apos;t load your members.
              </p>
              <p className="max-w-sm text-sm text-ink-soft">
                {membersError.join(' ')}
              </p>
              <button
                type="button"
                onClick={retryMembers}
                className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2"
              >
                Retry
              </button>
            </div>
          ) : displayMembers.length === 0 ? (
            <div
              role="status"
              aria-label="Loading members"
              className="flex justify-center py-24"
            >
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt" />
            </div>
          ) : (
            <OrgView
              org={org}
              members={displayMembers}
              projects={projects}
              viewAs={roleKey}
              myEmail={authUser?.email}
              canManageOrg={canManageOrg}
              canManageMembers={canManageMembers}
              graphKey={viewKey}
              onAddMember={() => void handleAddMember()}
              onRemoveMember={(index) => void handleRemoveMember(index)}
              onRoleChange={handleRoleChange}
              onEditOrg={() => void handleEditOrg()}
              onDeleteOrg={() => void handleDeleteOrg()}
              onNewProject={() => show('Projects page is next')}
            />
          )
        ) : canManageOrg ? (
          <EmptyOrgView onCreate={handleCreateOrg} />
        ) : (
          <NoOrgView
            email={authUser?.email ?? CURRENT_USER.email}
            onCheckAgain={handleCheckAgain}
            onSignOut={handleLogout}
            onToast={show}
          />
        )}
      </div>
      {dialogElement}
      {toastElement}
    </AppShell>
  );
}
