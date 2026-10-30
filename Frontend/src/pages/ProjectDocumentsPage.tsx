import { cn } from 'cn';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDialog } from '@/components/dashboard/AppDialog';
import { AppShell } from '@/components/dashboard/AppShell';
import { LockIcon } from '@/components/dashboard/Icons';
import { Avatar } from '@/components/dashboard/OrgView';
import { ProjectTabs } from '@/components/dashboard/ProjectTabs';
import { Skeleton } from '@/components/dashboard/Skeleton';
import { useToast } from '@/components/dashboard/Toast';
import { ApiError, getProject, logout, type Project } from '@/lib/api';
import { BTN, CURRENT_USER, pad2, ROLES, toRoleKey } from '@/lib/dashboard';
import {
  ALLOWED,
  extOf,
  fmtDate,
  fmtSize,
  MAX_MB,
  type ProjectDoc,
  seedDocs,
  TYPE_COLORS,
  type UploadingDoc,
} from '@/lib/documents';
import { useAppDispatch, useAppSelector, useOrganization } from '@/store/hooks';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearMembers } from '@/store/slices/membersSlice';
import { clearOrg } from '@/store/slices/orgSlice';
import { clearProjects, upsertProject } from '@/store/slices/projectsSlice';

function LockedScreen({
  title,
  note,
  cta,
  to,
}: {
  title: string;
  note: string;
  cta: string;
  to: string;
}) {
  return (
    <div className="max-w-2xl border border-ink p-8 sm:p-10">
      <span className="flex h-12 w-12 items-center justify-center bg-paper text-ink-soft">
        <LockIcon className="h-6 w-6" />
      </span>
      <h1 className="mt-5 font-display text-3xl font-bold leading-tight tracking-tight">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-sm text-ink-soft">{note}</p>
      <Link to={to} className={`mt-6 inline-block ${BTN}`}>
        {cta}
      </Link>
    </div>
  );
}

/** Layout-matching placeholder for the documents page while the project loads. */
function DocsSkeleton() {
  const header = [
    { key: 'name', width: 'w-40' },
    { key: 'by', width: 'w-28' },
    { key: 'date', width: 'w-14' },
    { key: 'size', width: 'w-12' },
    { key: 'actions', width: 'w-24' },
  ];
  return (
    <div role="status" aria-label="Loading project" className="space-y-10">
      <div
        className="border border-ink p-6 pl-7 sm:p-8 sm:pl-9"
        style={{ boxShadow: 'inset 6px 0 0 #CDD0E0' }}
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </div>
      <div className="flex gap-1 border-b border-ink-line pb-px">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-36" />
      </div>
      <section>
        <div className="mb-1 flex items-end justify-between gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-9 w-32" />
        </div>
        <Skeleton className="mb-3 h-4 w-80 max-w-full" />
        <Skeleton className="mb-3 h-9 w-72" />
        <div className="border border-ink">
          <div className="hidden gap-x-4 border-b border-ink bg-paper px-4 py-2 sm:grid sm:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_70px_70px_150px]">
            {header.map((cell) => (
              <Skeleton key={cell.key} className={`h-3 ${cell.width}`} />
            ))}
          </div>
          <ul>
            {[0, 1, 2, 3].map((row) => (
              <li
                key={row}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-ink-line px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_70px_70px_150px]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Skeleton className="h-10 w-10 shrink-0" />
                  <Skeleton className="h-4 w-44" />
                </div>
                <div className="hidden sm:block">
                  <Skeleton className="h-4 w-28" />
                </div>
                <div className="hidden sm:block">
                  <Skeleton className="h-3.5 w-12" />
                </div>
                <div className="hidden sm:block">
                  <Skeleton className="h-3.5 w-12" />
                </div>
                <div className="flex justify-end gap-3">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-12" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

export function ProjectDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { show, element: toastElement } = useToast();
  const { ask, element: dialogElement } = useDialog();
  const authUser = useAppSelector((session) => session.auth.user);
  const { org } = useOrganization();

  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'error' | 'notfound'
  >('loading');
  const [error, setError] = useState<string[]>([]);
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [uploading, setUploading] = useState<UploadingDoc[]>([]);
  const [docQuery, setDocQuery] = useState('');
  /** Upload-simulation intervals — cleared on unmount so none outlive the page. */
  const timersRef = useRef<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /** The server's project is the source of truth — synced to the list too. */
  const adopt = useCallback(
    (next: Project): void => {
      setProject(next);
      setStatus('ready');
      dispatch(upsertProject(next));
    },
    [dispatch],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!id) return;
    setStatus('loading');
    setError([]);
    try {
      const { project: fetched } = await getProject(id);
      adopt(fetched);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setStatus('notfound');
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        dispatch(setAnonymous());
        return;
      }
      setStatus('error');
      setError(
        err instanceof ApiError
          ? err.messages
          : ['Something went wrong. Please try again.'],
      );
    }
  }, [id, adopt, dispatch]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) window.clearInterval(timer);
    };
  }, []);

  // Demo seed follows the roster — same adjustment-during-render pattern the
  // board page uses when the route id (or store catch-up) changes.
  const seededFor = useRef<string | null>(null);
  if (project && seededFor.current !== project.id) {
    seededFor.current = project.id;
    setDocs(seedDocs(project.members));
    setUploading([]);
    setDocQuery('');
  }

  const viewerId = authUser?.id ?? null;
  const actorRole = authUser?.role;
  const members = project?.members ?? [];
  const isMember =
    viewerId !== null && members.some((member) => member.userId === viewerId);
  const isLead =
    viewerId !== null &&
    members.some((member) => member.userId === viewerId && member.isLead);
  // Mirror the server policy: Admin, or a PM who sits on the project.
  const canManage = actorRole === 'Admin' || (actorRole === 'PM' && isMember);
  // Design's canUpload(): everyone on the project (HR never reaches this page).
  const canUpload = actorRole === 'Admin' || isMember;
  // Design's canDeleteDoc(): owner/manager, lead, or whoever uploaded it.
  const canDeleteDoc = (doc: ProjectDoc): boolean =>
    canManage || isLead || doc.byUserId === viewerId;

  useEffect(() => {
    document.title = project
      ? `${project.name} documents · Nexus`
      : 'Documents · Nexus';
  }, [project]);

  /** This device only — same action as the sidebar Log out. */
  const handleLogout = (): void => {
    void (async () => {
      try {
        await logout();
      } catch {
        // Best-effort server-side invalidation; the cookie still dies at TTL.
      }
      dispatch(clearProjects());
      dispatch(clearMembers());
      dispatch(clearOrg());
      dispatch(setAnonymous());
      navigate('/', { replace: true });
    })();
  };

  const memberByUserId = (userId: string): string =>
    members.find((member) => member.userId === userId)?.name ?? 'Unknown';

  const typeBadge = (name: string): ReactNode => {
    const ext = extOf(name);
    return (
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center text-[10px] font-bold uppercase text-white"
        style={{ background: TYPE_COLORS[ext] ?? '#8A90AD' }}
      >
        {ext.slice(0, 4) || 'file'}
      </span>
    );
  };

  const query = docQuery.trim();
  const shownDocs = query
    ? docs.filter((doc) => doc.name.toLowerCase().includes(query.toLowerCase()))
    : docs;
  const foundText = query ? `${shownDocs.length} of ${docs.length} match` : '';

  /** Highlight the first search match inside a file name. */
  const highlight = (name: string): ReactNode => {
    const index = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (index < 0) return name;
    return (
      <>
        {name.slice(0, index)}
        <mark className="bg-sun text-ink">
          {name.slice(index, index + query.length)}
        </mark>
        {name.slice(index + query.length)}
      </>
    );
  };

  const openFilePicker = (): void => fileInputRef.current?.click();

  const addFiles = (list: FileList | null): void => {
    if (!list || list.length === 0) return;
    setDocQuery('');
    const skipped: string[] = [];
    Array.from(list).forEach((file, index) => {
      const ext = extOf(file.name);
      if (!(ALLOWED as readonly string[]).includes(ext)) {
        skipped.push(
          `${file.name}: .${ext || 'unknown'} files aren't supported`,
        );
        return;
      }
      if (file.size > MAX_MB * 1_048_576) {
        skipped.push(`${file.name}: larger than ${MAX_MB} MB`);
        return;
      }
      const uploadId = `u${Date.now()}${index}`;
      setUploading((prev) => [
        ...prev,
        { id: uploadId, name: file.name, size: file.size, progress: 0 },
      ]);
      // Demo progress. Replace with a real upload that reports progress.
      let progress = 0;
      const timer = window.setInterval(() => {
        progress = Math.min(100, progress + 12 + Math.random() * 18);
        if (progress >= 100) {
          window.clearInterval(timer);
          timersRef.current = timersRef.current.filter((t) => t !== timer);
          setUploading((prev) => prev.filter((row) => row.id !== uploadId));
          setDocs((prev) => [
            {
              id: uploadId,
              name: file.name,
              byUserId: viewerId ?? '',
              size: file.size,
              at: new Date().toISOString(),
              url: URL.createObjectURL(file),
            },
            ...prev,
          ]);
          return;
        }
        setUploading((prev) =>
          prev.map((row) => (row.id === uploadId ? { ...row, progress } : row)),
        );
      }, 120);
      timersRef.current.push(timer);
    });
    if (skipped.length > 0) {
      show(
        skipped[0] +
          (skipped.length > 1
            ? ` (and ${skipped.length - 1} more skipped)`
            : ''),
      );
    }
  };

  const handleDownload = (doc: ProjectDoc): void => {
    if (!doc.url) {
      show('Sample document: there is nothing to download in the demo');
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = doc.url;
    anchor.download = doc.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleDeleteDoc = async (doc: ProjectDoc): Promise<void> => {
    const confirmed = await ask({
      title: 'Delete this document?',
      ok: 'Delete document',
      danger: true,
      body: (
        <p>
          <strong className="text-ink">{doc.name}</strong> will be removed for
          everyone on the project. This can&apos;t be undone.
        </p>
      ),
    });
    if (!confirmed) return;
    if (doc.url) URL.revokeObjectURL(doc.url);
    setDocs((prev) => prev.filter((item) => item.id !== doc.id));
    show('Document deleted'); // TODO: DELETE /projects/:id/documents/:docId
  };

  const docsBody = (): ReactNode => {
    const empty = docs.length === 0 && uploading.length === 0;
    if (empty && !canUpload) {
      return (
        <p className="border border-dashed border-ink-line p-8 text-center text-sm text-ink-soft">
          No documents yet. People on the project can upload them here.
        </p>
      );
    }
    const zone = canUpload ? (
      <button
        type="button"
        id="dropzone"
        aria-label="Upload documents. Drop files here, or press Enter to choose files."
        onClick={openFilePicker}
        onDragOver={(event) => {
          event.preventDefault();
          event.currentTarget.classList.add('border-cobalt', 'bg-paper');
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            event.currentTarget.classList.remove('border-cobalt', 'bg-paper');
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.classList.remove('border-cobalt', 'bg-paper');
          addFiles(event.dataTransfer.files);
        }}
        className={cn(
          'flex w-full cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed border-ink-soft/40 px-6 text-center transition-colors hover:border-cobalt hover:bg-paper focus-visible:border-cobalt focus-visible:outline-none',
          empty ? 'py-12' : 'py-5',
        )}
      >
        <svg
          className="h-7 w-7 text-ink-soft"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="square"
          aria-hidden="true"
        >
          <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
        </svg>
        <span className="block font-semibold">
          {empty ? 'No documents yet. ' : ''}Drop files here or{' '}
          <span className="text-cobalt underline underline-offset-2">
            choose files
          </span>
        </span>
        <span className="block text-xs text-ink-soft">
          PDF, Office files, images, CSV or ZIP. Up to {MAX_MB} MB each.
        </span>
      </button>
    ) : null;

    const uploadingRows = uploading.map((row) => (
      <li
        key={row.id}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-ink-line px-4 py-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          {typeBadge(row.name)}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{row.name}</p>
            <div
              className="mt-1.5 h-1.5 w-full max-w-xs bg-paper"
              role="progressbar"
              aria-valuenow={Math.round(row.progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-cobalt"
                style={{ width: `${row.progress}%` }}
              />
            </div>
          </div>
        </div>
        <span className="text-sm text-ink-soft">
          {Math.round(row.progress)}%
        </span>
      </li>
    ));

    const noMatch =
      docs.length > 0 && shownDocs.length === 0 && uploading.length === 0;
    const docRows = shownDocs.map((doc) => {
      const uploader = members.find((member) => member.userId === doc.byUserId);
      return (
        <li
          key={doc.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-ink-line px-4 py-3 last:border-b-0 hover:bg-paper/70 sm:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_70px_70px_150px]"
        >
          <div className="flex min-w-0 items-center gap-3">
            {typeBadge(doc.name)}
            <div className="min-w-0">
              <p className="truncate font-semibold">{highlight(doc.name)}</p>
              <p className="truncate text-xs text-ink-soft sm:hidden">
                {fmtSize(doc.size)} · {memberByUserId(doc.byUserId)} ·{' '}
                {fmtDate(doc.at)}
              </p>
            </div>
          </div>
          <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
            {uploader ? (
              <Avatar name={uploader.name} size="h-6 w-6 text-[9px]" />
            ) : null}
            <span className="truncate">{uploader?.name ?? 'Unknown'}</span>
          </div>
          <span className="hidden text-sm text-ink-soft sm:block">
            {fmtDate(doc.at)}
          </span>
          <span className="hidden text-sm text-ink-soft sm:block">
            {fmtSize(doc.size)}
          </span>
          <div className="flex items-center justify-end gap-4 text-sm">
            <button
              type="button"
              onClick={() => handleDownload(doc)}
              className="font-semibold text-cobalt underline-offset-2 hover:underline"
            >
              Download
            </button>
            {canDeleteDoc(doc) ? (
              <button
                type="button"
                onClick={() => void handleDeleteDoc(doc)}
                className="text-ink-soft underline-offset-2 hover:text-red-600 hover:underline"
              >
                Delete
              </button>
            ) : null}
          </div>
        </li>
      );
    });

    const table = noMatch ? (
      <p
        className={`${canUpload ? 'mt-3 ' : ''}border border-dashed border-ink-line p-8 text-center text-sm text-ink-soft`}
      >
        No documents match &ldquo;{query}&rdquo;.{' '}
        <button
          type="button"
          onClick={() => {
            setDocQuery('');
            searchInputRef.current?.focus();
          }}
          className="font-semibold text-cobalt underline-offset-2 hover:underline"
        >
          Clear search
        </button>
      </p>
    ) : docs.length > 0 || uploading.length > 0 ? (
      <div className={`${canUpload ? 'mt-3 ' : ''}border border-ink`}>
        <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_70px_70px_150px] gap-x-4 border-b border-ink bg-paper px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft sm:grid">
          <span>Name</span>
          <span>Uploaded by</span>
          <span>Date</span>
          <span>Size</span>
          <span />
        </div>
        <ul>
          {uploadingRows}
          {docRows}
        </ul>
      </div>
    ) : null;

    return (
      <>
        {zone}
        {table}
      </>
    );
  };

  const crumb = (
    <>
      {org ? (
        <>
          <span>{org.name}</span>
          <span className="mx-1.5 text-ink-line">/</span>
        </>
      ) : null}
      <Link to="/dashboard/projects" className="hover:text-ink">
        Projects
      </Link>
      {project ? (
        <>
          <span className="mx-1.5 text-ink-line">/</span>
          <Link
            to={`/dashboard/projects/${project.id}`}
            className="hover:text-ink"
          >
            {project.name}
          </Link>
          <span className="mx-1.5 text-ink-line">/</span>
          <span className="font-semibold text-ink">Documents</span>
        </>
      ) : (
        <>
          <span className="mx-1.5 text-ink-line">/</span>
          <span className="font-semibold text-ink"> Not found</span>
        </>
      )}
    </>
  );

  let body: ReactNode;
  if (status === 'loading') {
    body = <DocsSkeleton />;
  } else if (status === 'notfound') {
    body = (
      <LockedScreen
        title="Project not found"
        note="This project doesn't exist, or it was deleted."
        cta="Back to Projects"
        to="/dashboard/projects"
      />
    );
  } else if (status === 'error' || !project) {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-[15px] font-semibold text-ink">
          Couldn&apos;t load this project.
        </p>
        <p className="max-w-sm text-sm text-ink-soft">{error.join(' ')}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark"
        >
          Retry
        </button>
      </div>
    );
  } else if (actorRole === 'HR') {
    body = (
      <LockedScreen
        title="Projects aren't part of the HR role"
        note="HR looks after the people in the organization. Project work is handled by PMs, Admins and Devs."
        cta="Go to Organization"
        to="/dashboard"
      />
    );
  } else if (actorRole !== 'Admin' && !isMember) {
    body = (
      <LockedScreen
        title="You're not on this project"
        note="Ask the project owner to add you, and it will show up in your Projects list."
        cta="Back to Projects"
        to="/dashboard/projects"
      />
    );
  } else {
    body = (
      <>
        <div
          className="border border-ink p-6 pl-7 sm:p-8 sm:pl-9"
          style={{ boxShadow: `inset 6px 0 0 ${project.color}` }}
        >
          <Link
            to="/dashboard/projects"
            className="text-sm text-ink-soft hover:text-ink"
          >
            ← All projects
          </Link>
          <h1 className="mt-2 font-display text-3xl font-bold leading-none tracking-tight">
            {project.name}
          </h1>
          {project.description ? (
            <p className="mt-2 max-w-2xl text-sm text-ink-soft">
              {project.description}
            </p>
          ) : null}
        </div>
        <ProjectTabs
          projectId={project.id}
          active="documents"
          docCount={docs.length}
        />
        <section
          id="documents"
          className="mt-10 scroll-mt-20"
          aria-labelledby="h-docs"
        >
          <div className="mb-1 flex items-end justify-between gap-3">
            <h2
              id="h-docs"
              className="font-display text-2xl font-bold tracking-tight"
            >
              Documents{' '}
              <span className="ml-1 align-middle font-sans text-sm font-bold text-ink-soft">
                {pad2(docs.length)}
              </span>
            </h2>
            {canUpload ? (
              <button type="button" onClick={openFilePicker} className={BTN}>
                Upload files
              </button>
            ) : null}
          </div>
          <p className="mb-3 text-sm text-ink-soft">
            Shared with everyone on this project. Members can upload. The owner,
            the lead and whoever uploaded a file can delete it.
          </p>
          <div
            className={`mb-3 flex flex-wrap items-center gap-3 ${docs.length === 0 ? 'hidden' : ''}`}
          >
            <input
              ref={searchInputRef}
              type="search"
              value={docQuery}
              onChange={(event) => setDocQuery(event.target.value)}
              placeholder="Search documents by name"
              aria-label="Search documents by name"
              autoComplete="off"
              className="w-full max-w-xs border border-ink/40 bg-white px-3.5 py-2 text-[15px] outline-none transition focus:border-cobalt focus:ring-2 focus:ring-cobalt/25"
            />
            <span className="text-sm text-ink-soft" aria-live="polite">
              {foundText}
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            tabIndex={-1}
            className="sr-only"
            accept={ALLOWED.map((ext) => `.${ext}`).join(',')}
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <div>{docsBody()}</div>
        </section>
      </>
    );
  }

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
      <div className="view-in">{body}</div>
      {dialogElement}
      {toastElement}
    </AppShell>
  );
}
