import { cn } from 'cn';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface DialogConfig {
  title: string;
  body: ReactNode;
  ok: string;
  danger?: boolean;
  validate?: (data: FormData) => string;
}

/**
 * Port of the design's `ask()` helper: opens a native <dialog>, resolves
 * FormData on submit, or null on cancel/Escape/backdrop-free close.
 */
export function useDialog() {
  const [config, setConfig] = useState<DialogConfig | null>(null);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolverRef = useRef<((value: FormData | null) => void) | null>(null);

  const done = (value: FormData | null): void => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConfig(null);
    resolve?.(value);
  };

  const ask = (next: DialogConfig): Promise<FormData | null> => {
    setConfig(next);
    setError('');
    return new Promise<FormData | null>((resolve) => {
      resolverRef.current = resolve;
    });
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (config && dialog && !dialog.open) {
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, button',
      );
      first?.focus();
    }
  }, [config]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const message = config?.validate?.(data) ?? '';
    if (message) {
      setError(message);
      return;
    }
    done(data);
  };

  const element = (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        done(null);
      }}
      className="fixed left-1/2 top-1/2 z-50 m-0 max-h-[85vh] w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto border-2 border-ink bg-white p-0 shadow-[8px_8px_0_#14183A] [&::backdrop]:bg-ink/50"
    >
      <form onSubmit={handleSubmit} className="p-6" noValidate>
        <h2 className="font-display text-xl font-bold tracking-tight">
          {config?.title}
        </h2>
        <div className="mt-3 space-y-3 text-sm text-ink-soft">
          {config?.body}
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-3 border-l-4 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => done(null)}
            className="border border-ink px-4 py-2 text-sm font-semibold hover:bg-paper"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={cn(
              'px-4 py-2 text-sm font-semibold text-white',
              config?.danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-cobalt hover:bg-cobalt-dark',
            )}
          >
            {config?.ok}
          </button>
        </div>
      </form>
    </dialog>
  );

  return { ask, element };
}
