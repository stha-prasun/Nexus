import { cn } from 'cn';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Fixed toast at the bottom center — same behavior as the design's #toast. */
export function useToast() {
  const [message, setMessage] = useState('');
  const timerRef = useRef<number | undefined>(undefined);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setMessage(''), 2200);
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const element = (
    <div
      role="status"
      className={cn(
        'pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 bg-ink px-4 py-2.5 text-sm font-medium text-white opacity-0 transition-[opacity,transform] duration-[250ms]',
        message ? 'translate-y-0 opacity-100' : 'translate-y-2',
      )}
    >
      {message}
    </div>
  );

  return { show, element };
}
