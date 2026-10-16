import { type CSSProperties, type FormEvent, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import type { Org } from '@/lib/dashboard';
import { INPUT, SLUG_PATTERN, slugify } from '@/lib/dashboard';

interface EmptyOrgViewProps {
  /** POSTs the new organization; an ApiError rejection shows inline. */
  onCreate: (org: Org) => Promise<void>;
}

/** Staggered entrance index for the design's `.rise` animation. */
const rise = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

export function EmptyOrgView({ onCreate }: EmptyOrgViewProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const shake = (): void => {
    const card = cardRef.current;
    if (!card) return;
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  };

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    const message =
      trimmedName.length < 2
        ? 'Give your organization a name.'
        : !SLUG_PATTERN.test(trimmedSlug) || trimmedSlug.length < 3
          ? 'The URL needs at least 3 letters or numbers. Use hyphens between words.'
          : '';
    if (message) {
      setError(message);
      shake();
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onCreate({ name: trimmedName, slug: trimmedSlug });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
      shake();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="dots relative overflow-hidden bg-cobalt px-5 py-10 text-white sm:px-10 sm:py-14"
      aria-labelledby="title"
    >
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-14">
        {/* Left: what an organization is and what happens next */}
        <div>
          <p
            className="rise text-xs font-bold uppercase tracking-wider text-sun"
            style={rise(0)}
          >
            Get started
          </p>
          <h1
            id="title"
            className="rise mt-3 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl"
            style={rise(1)}
          >
            Set up your organization
          </h1>
          <p className="rise mt-4 max-w-md text-white/80" style={rise(2)}>
            Everything in Nexus lives inside one organization: your people, your
            projects and every task.
          </p>

          <ol className="mt-8 max-w-md border-t border-white/30">
            <li
              className="rise flex gap-4 border-b border-white/30 py-4"
              style={rise(3)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-sun text-sm font-bold text-ink">
                01
              </span>
              <div>
                <p className="font-semibold">Create your organization</p>
                <p className="mt-0.5 text-sm text-white/75">
                  Give it a name and claim a URL.
                </p>
              </div>
            </li>
            <li
              className="rise flex gap-4 border-b border-white/30 py-4"
              style={rise(4)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-white/60 text-sm font-bold">
                02
              </span>
              <div>
                <p className="font-semibold">Add your people</p>
                <p className="mt-0.5 text-sm text-white/75">
                  Invite teammates as PM, HR or Dev.
                </p>
              </div>
            </li>
            <li
              className="rise flex gap-4 border-b border-white/30 py-4"
              style={rise(5)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-white/60 text-sm font-bold">
                03
              </span>
              <div>
                <p className="font-semibold">Start a project</p>
                <p className="mt-0.5 text-sm text-white/75">
                  Pick members from your organization and open the board.
                </p>
              </div>
            </li>
          </ol>
        </div>

        {/* Right: the form */}
        <div
          ref={cardRef}
          className="rise border-2 border-ink bg-white p-7 text-ink shadow-[8px_8px_0_#FFD83D] sm:p-8"
          style={rise(3)}
          onAnimationEnd={(event) => {
            if (event.animationName === 'shake') {
              event.currentTarget.classList.remove('shake');
            }
          }}
        >
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Create organization
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            You can rename it later. Each account has one organization.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            {error ? (
              <p
                role="alert"
                className="border-l-4 border-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-800"
              >
                {error}
              </p>
            ) : null}

            <div>
              <label
                htmlFor="name"
                className="mb-1.5 block text-sm font-semibold"
              >
                Organization name
              </label>
              <input
                id="name"
                autoComplete="organization"
                placeholder="Nexus"
                value={name}
                onChange={(event) => {
                  const value = event.target.value;
                  setName(value);
                  if (!slugTouched) setSlug(slugify(value));
                }}
                className={INPUT}
              />
            </div>

            <div>
              <label
                htmlFor="slug"
                className="mb-1.5 block text-sm font-semibold"
              >
                Organization URL
              </label>
              <div className="flex border border-ink/40 bg-white transition focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt/25">
                <span className="flex items-center border-r border-ink/40 bg-paper px-3 text-sm text-ink-soft">
                  nexus.app/
                </span>
                <input
                  id="slug"
                  autoComplete="off"
                  placeholder="nexus"
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, ''),
                    );
                  }}
                  className="min-w-0 flex-1 bg-white px-3 py-2.5 text-[15px] outline-none placeholder:text-ink-soft/60"
                />
              </div>
              <p className="mt-1.5 text-[13px] text-ink-soft">
                Lowercase letters, numbers and hyphens.
              </p>
            </div>

            <p className="border-l-2 border-cobalt pl-3 text-sm text-ink-soft">
              As the Admin, you&apos;ll have full control over the organization,
              its members and projects.
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-sun px-4 py-3 font-display text-base font-bold tracking-tight text-ink transition hover:bg-sun-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 active:translate-y-px disabled:opacity-60"
            >
              {submitting ? 'Creating…' : 'Create organization'}
            </button>
          </form>

          <p className="mt-5 border-t border-ink-line pt-4 text-sm text-ink-soft">
            Only an Admin can create the organization. If your account
            shouldn&apos;t have the Admin role, contact whoever provisioned it.
          </p>
        </div>
      </div>
    </section>
  );
}
