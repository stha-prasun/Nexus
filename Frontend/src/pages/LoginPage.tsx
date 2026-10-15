import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { cssVars, TaskGraph } from '@/components/auth/TaskGraph';
import { ApiError, login } from '@/lib/api';
import { setPendingEmail } from '@/lib/resend';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setUser } from '@/store/slices/authSlice';

export function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const authStatus = useAppSelector((state) => state.auth.status);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [graphActive, setGraphActive] = useState(false);

  const panelRef = useRef<HTMLElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Sign in · Nexus';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const triggerShake = () => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.classList.remove('shake');
    void panel.offsetWidth;
    panel.classList.add('shake');
  };

  const handlePanelAnimationEnd = () => {
    panelRef.current?.classList.remove('shake');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = emailRef.current?.value.trim() ?? '';
    const password = passwordRef.current?.value ?? '';
    const remember = rememberRef.current?.checked ?? false;

    let message = '';
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      message = 'Enter a valid email address, like name@company.com.';
    } else if (password.length < 1) {
      message = 'Enter your password.';
    }
    setErrorMessage(message);
    if (message) {
      triggerShake();
      return;
    }

    setSubmitting(true);
    void (async () => {
      try {
        const { user } = await login({ email, password, remember });
        dispatch(setUser(user));
        navigate('/dashboard', { replace: true });
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          // Correct password, unverified account — resend flow takes over.
          setPendingEmail(email);
          navigate('/confirm-sent', { state: { email } });
          return;
        }
        setErrorMessage(
          error instanceof ApiError
            ? error.messages.join(' ')
            : 'Something went wrong. Please try again.',
        );
        setSubmitting(false);
        triggerShake();
      }
    })();
  };

  // Already signed in (session restored on load, or login just succeeded).
  if (authStatus === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <main className="canvas relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-4 font-sans text-ink antialiased">
      {/* ===== Task graph (decorative, desktop only) ===== */}
      <TaskGraph active={graphActive} />

      {/* ===== Sign-in panel: the "nexus" every task connects to ===== */}
      <div className="panel-wrap relative z-10 w-full max-w-[460px]">
        <span className="ring" aria-hidden="true" />
        <span
          className="ring"
          style={cssVars({ '--d': '4.1s' })}
          aria-hidden="true"
        />
        <section
          id="panel"
          ref={panelRef}
          className="relative rounded-[0.375rem] bg-white p-6 shadow-[0_24px_60px_-20px_rgba(10,15,80,.6)] sm:px-8 sm:py-7"
          aria-labelledby="title"
          onAnimationEnd={handlePanelAnimationEnd}
        >
          {/* Logo: three connected nodes */}
          <div className="mb-5 flex items-center gap-2.5">
            <svg
              className="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 8.500v3.500M12 12l-5.500 4M12 12l5.500 4"
                stroke="#1F2FE0"
                strokeWidth="1.800"
                strokeLinecap="round"
              />
              <circle
                cx="12"
                cy="6"
                r="3.500"
                fill="#FFD83D"
                stroke="#1F2FE0"
                strokeWidth="1.800"
              />
              <circle cx="5.500" cy="17.500" r="2.500" fill="#1F2FE0" />
              <circle cx="18.500" cy="17.500" r="2.500" fill="#1F2FE0" />
            </svg>
            <span className="font-display text-xl font-bold tracking-tight">
              Nexus
            </span>
          </div>

          <h1
            id="title"
            className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
          >
            Sign in
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-soft [@media(max-height:640px)]:hidden">
            {"Your team's tasks are waiting."}
          </p>

          <form
            id="login-form"
            className="mt-5 space-y-3.5"
            noValidate
            onSubmit={handleSubmit}
            onFocus={() => setGraphActive(true)}
            onBlur={() => setGraphActive(false)}
          >
            <div
              id="form-error"
              role="alert"
              className={`rounded border-l-4 border-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-800${errorMessage ? '' : ' hidden'}`}
            >
              {errorMessage}
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-semibold"
              >
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="name@company.com"
                ref={emailRef}
                className="w-full rounded border border-ink-line bg-white px-3.5 py-2 text-[15px] placeholder:text-ink-soft/60 outline-none transition focus:border-cobalt focus:ring-[3px] focus:ring-cobalt/20"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="password" className="text-sm font-semibold">
                  Password
                </label>
                <a
                  // biome-ignore lint/a11y/useValidAnchor: placeholder link, matches original design
                  href="#"
                  className="text-sm text-cobalt underline-offset-2 hover:underline focus-visible:underline"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="At least 8 characters"
                  ref={passwordRef}
                  className="w-full rounded border border-ink-line bg-white py-2 pl-3.5 pr-11 text-[15px] placeholder:text-ink-soft/60 outline-none transition focus:border-cobalt focus:ring-[3px] focus:ring-cobalt/20"
                />
                <button
                  type="button"
                  id="toggle-password"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((show) => !show)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-soft outline-none hover:text-ink focus-visible:text-cobalt"
                >
                  <svg
                    id="icon-eye"
                    className={showPassword ? 'hidden h-5 w-5' : 'h-5 w-5'}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.800"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg
                    id="icon-eye-off"
                    className={showPassword ? 'h-5 w-5' : 'hidden h-5 w-5'}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.800"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 3l18 18M10.600 5.100A9.800 9.800 0 0112 5c6.500 0 10 7 10 7a17 17 0 01-3.200 4M6.600 6.600C3.900 8.300 2 12 2 12s3.500 7 10 7c1.500 0 2.900-.3 4.100-.9" />
                    <path d="M9.900 9.900a3 3 0 004.200 4.200" />
                  </svg>
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft">
              <input
                type="checkbox"
                name="remember"
                ref={rememberRef}
                className="h-4 w-4 rounded-[0.125rem] border-ink-line text-cobalt focus:ring-cobalt/30"
              />
              Keep me signed in on this device
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-sun px-4 py-2.5 font-display text-base font-bold tracking-tight text-ink transition hover:bg-sun-dark focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/40 active:translate-y-px"
            >
              {submitting ? 'Signing in…' : 'Sign in to Nexus'}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3 text-sm text-ink-soft">
            <span className="h-px flex-1 bg-ink-line" />
            or
            <span className="h-px flex-1 bg-ink-line" />
          </div>

          <div>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2.5 rounded border border-ink-line bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-mist focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/25"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.600 12.200c0-.8-.1-1.500-.2-2.200H12v4.200h5.900a5 5 0 01-2.200 3.300v2.700h3.500c2.100-1.900 3.400-4.700 3.400-8z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c3 0 5.400-1 7.200-2.700l-3.500-2.700c-1 .7-2.200 1.100-3.700 1.100-2.900 0-5.300-1.900-6.200-4.500H2.200v2.800A11 11 0 0012 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.800 14.200a6.600 6.600 0 010-4.300V7.100H2.200a11 11 0 000 9.900l3.600-2.800z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.400c1.600 0 3.100.6 4.300 1.700l3.200-3.200A11 11 0 002.200 7.100l3.600 2.800C6.700 7.300 9.100 5.400 12 5.400z"
                />
              </svg>
              Continue with Google
            </button>
          </div>

          <p className="mt-5 text-center text-sm text-ink-soft">
            No account yet?{' '}
            <Link
              to="/signup"
              className="font-semibold text-cobalt underline-offset-2 hover:underline focus-visible:underline"
            >
              Create one
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
