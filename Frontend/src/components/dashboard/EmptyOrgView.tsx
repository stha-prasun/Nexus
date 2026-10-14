import { type FormEvent, useState } from 'react';
import type { Org } from '@/lib/dashboard';
import { INPUT, SLUG_PATTERN, slugify } from '@/lib/dashboard';
import { NexusLogo } from './Icons';

interface EmptyOrgViewProps {
  onCreate: (org: Org) => void;
}

export function EmptyOrgView({ onCreate }: EmptyOrgViewProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
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
      return;
    }
    onCreate({ name: trimmedName, slug: trimmedSlug });
  };

  return (
    <section className="dots bg-cobalt px-5 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-md border-2 border-ink bg-white p-7 shadow-[8px_8px_0_#FFD83D] sm:p-8">
        <span className="flex h-12 w-12 items-center justify-center bg-sun">
          <NexusLogo className="h-6 w-6" />
        </span>
        <h1 className="mt-5 font-display text-[1.75rem] font-bold leading-tight tracking-tight">
          Create your organization
        </h1>
        <p className="mt-1.5 text-ink-soft">
          It holds your people and your projects. You&apos;ll be its PM, with
          full control.
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
              htmlFor="o-name"
              className="mb-1.5 block text-sm font-semibold"
            >
              Organization name
            </label>
            <input
              id="o-name"
              autoComplete="organization"
              placeholder="Acme Design"
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
              htmlFor="o-slug"
              className="mb-1.5 block text-sm font-semibold"
            >
              Organization URL
            </label>
            <div className="flex border border-ink/40 bg-white transition focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt/25">
              <span className="flex items-center border-r border-ink/40 bg-paper px-3 text-sm text-ink-soft">
                nexus.app/
              </span>
              <input
                id="o-slug"
                autoComplete="off"
                placeholder="acme-design"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(
                    event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                  );
                }}
                className="min-w-0 flex-1 bg-white px-3 py-2.5 text-[15px] outline-none placeholder:text-ink-soft/60"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full bg-sun px-4 py-3 font-display text-base font-bold tracking-tight text-ink hover:bg-sun-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            Create organization
          </button>
        </form>
        <p className="mt-5 text-sm text-ink-soft">
          Expecting an invite instead? Ask your PM to add your email, and the
          organization will appear here.
        </p>
      </div>
    </section>
  );
}
