/**
 * Shown to non-Admin signed-in users while the singleton organization does
 * not exist yet. No create form and no extra API call — the Admin creates
 * the organization, then adds them.
 */
export function NoOrgView() {
  return (
    <section
      className="dots relative overflow-hidden bg-cobalt px-5 py-16 text-white sm:px-10 sm:py-20"
      aria-labelledby="no-org-title"
    >
      <div className="mx-auto max-w-md text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center bg-sun font-display text-xl font-bold text-ink">
          ?
        </span>
        <h1
          id="no-org-title"
          className="mt-5 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
        >
          No organization yet
        </h1>
        <p className="mt-3 text-white/80">
          You&apos;ll see the organization here once an Admin creates it — or
          adds you to an existing one.
        </p>
      </div>
    </section>
  );
}
