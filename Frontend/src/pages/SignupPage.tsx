import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router';
import { cssVars, TaskGraph } from '@/components/auth/TaskGraph';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError, type Role, register } from '@/lib/api';
import { setPendingEmail, startCooldown } from '@/lib/resend';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'PM', label: 'Project Manager' },
  { value: 'Dev', label: 'Developer' },
  { value: 'Admin', label: 'Admin' },
];

const passwordPolicyOk = (value: string): boolean =>
  value.length >= 8 &&
  value.length <= 72 &&
  /[a-z]/.test(value) &&
  /[A-Z]/.test(value) &&
  /\d/.test(value) &&
  /[^A-Za-z0-9]/.test(value);

const STRENGTH_LEVELS = [
  { text: '', color: '' },
  { text: 'Weak', color: '#EF4444' },
  { text: 'Fair', color: '#F59E0B' },
  { text: 'Good', color: '#1F2FE0' },
  { text: 'Strong', color: '#2FB67C' },
];

const strengthScore = (value: string) => {
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  if (!value) return 0;
  return Math.max(score, 1);
};

export function SignupPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [graphActive, setGraphActive] = useState(false);
  const [strength, setStrength] = useState(0);
  const [role, setRole] = useState<Role | ''>('');

  const panelRef = useRef<HTMLElement>(null);
  const fullnameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Create your account · Nexus';
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

  const handlePasswordInput = (event: ChangeEvent<HTMLInputElement>) => {
    setStrength(strengthScore(event.target.value));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = fullnameRef.current?.value.trim() ?? '';
    const email = emailRef.current?.value.trim() ?? '';
    const password = passwordRef.current?.value ?? '';
    const terms = termsRef.current?.checked ?? false;

    let message = '';
    if (name.length < 2) {
      message = 'Tell us your name so teammates can find you.';
    } else if (!/^\S+@\S+\.\S+$/.test(email)) {
      message = 'Enter a valid email address, like name@company.com.';
    } else if (!passwordPolicyOk(password)) {
      message =
        'Password needs 8+ characters with upper, lower, number and symbol.';
    } else if (!role) {
      message = 'Choose the role that fits you best.';
    } else if (!terms) {
      message = 'Please accept the Terms and Privacy Policy to continue.';
    }
    setErrorMessage(message);
    if (message) {
      triggerShake();
      return;
    }
    // Validated above; guard keeps the narrowing for register() honest.
    if (!role) return;

    setSubmitting(true);
    try {
      await register({ name, email, password, role });
      // Persist for /confirm-sent refresh + /verify-email resend; start the
      // 5-minute resend cooldown now (the confirmation mail just went out).
      setPendingEmail(email);
      startCooldown();
      navigate('/confirm-sent', { state: { email } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setErrorMessage(
          'Too many attempts — please wait a few minutes and try again.',
        );
      } else if (error instanceof ApiError) {
        setErrorMessage(error.messages[0]);
      } else {
        setErrorMessage('Something went wrong. Please try again.');
      }
      triggerShake();
      setSubmitting(false);
    }
  };

  const level = STRENGTH_LEVELS[strength];

  return (
    <main className="canvas relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-4 font-sans text-ink antialiased">
      {/* ===== Task graph (decorative, desktop only) ===== */}
      <TaskGraph active={graphActive} />

      {/* ===== Sign-up panel: the "nexus" every task connects to ===== */}
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
            Create your account
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-soft [@media(max-height:700px)]:hidden">
            {"Start organizing your team's work."}
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
                htmlFor="fullname"
                className="mb-1.5 block text-sm font-semibold"
              >
                Full name
              </label>
              <input
                id="fullname"
                name="fullname"
                type="text"
                autoComplete="name"
                required
                placeholder="Maya Kim"
                ref={fullnameRef}
                className="w-full rounded border border-ink-line bg-white px-3.5 py-2 text-[15px] placeholder:text-ink-soft/60 outline-none transition focus:border-cobalt focus:ring-[3px] focus:ring-cobalt/20"
              />
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
                <span
                  id="strength-label"
                  className="text-xs font-medium text-ink-soft"
                  aria-live="polite"
                  style={{ color: level.color }}
                >
                  {level.text}
                </span>
              </div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  placeholder="At least 8 characters"
                  ref={passwordRef}
                  onChange={handlePasswordInput}
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
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <svg
                    id="icon-eye-off"
                    className={showPassword ? 'h-5 w-5' : 'hidden h-5 w-5'}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.5 0 2.9-.3 4.1-.9" />
                    <path d="M9.9 9.9a3 3 0 004.2 4.2" />
                  </svg>
                </button>
              </div>
              <div
                id="strength-bars"
                className="mt-1.5 flex gap-1"
                aria-hidden="true"
              >
                {[0, 1, 2, 3].map((barIndex) => (
                  <span
                    key={barIndex}
                    className="h-1 flex-1 rounded-full bg-ink-line transition-colors duration-300"
                    style={{
                      backgroundColor: barIndex < strength ? level.color : '',
                    }}
                  />
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="role"
                className="mb-1.5 block text-sm font-semibold"
              >
                Role
              </label>
              <Select
                value={role === '' ? undefined : role}
                onValueChange={(value) => setRole(value as Role)}
                disabled={submitting}
              >
                <SelectTrigger
                  id="role"
                  name="role"
                  className="data-[size=default]:h-auto w-full rounded border border-ink-line bg-white px-3.5 text-[15px] text-ink outline-none transition focus:border-cobalt focus:ring-[3px] focus:ring-cobalt/20 focus-visible:border-cobalt focus-visible:ring-[3px] focus-visible:ring-cobalt/20 data-placeholder:text-ink-soft/60 [&_svg]:text-ink-soft"
                >
                  <SelectValue placeholder="Select your role" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="start"
                  className="min-w-(--radix-select-trigger-width) rounded border border-ink-line bg-white p-1 text-ink shadow-[0_18px_40px_-16px_rgba(10,15,80,.45)] ring-0"
                >
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="rounded py-2 pl-3.5 pr-8 text-[15px] text-ink focus:bg-mist focus:text-ink [&_svg]:text-cobalt"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-soft">
              <input
                type="checkbox"
                name="terms"
                required
                ref={termsRef}
                className="mt-0.5 h-4 w-4 rounded-[0.125rem] border-ink-line text-cobalt focus:ring-cobalt/30"
              />
              <span>
                {'I agree to the '}
                <a
                  // biome-ignore lint/a11y/useValidAnchor: placeholder link, matches original design
                  href="#"
                  className="font-medium text-ink underline underline-offset-2"
                >
                  Terms
                </a>
                {' and '}
                <a
                  // biome-ignore lint/a11y/useValidAnchor: placeholder link, matches original design
                  href="#"
                  className="font-medium text-ink underline underline-offset-2"
                >
                  Privacy Policy
                </a>
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-sun px-4 py-2.5 font-display text-base font-bold tracking-tight text-ink transition hover:bg-sun-dark focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/40 active:translate-y-px"
            >
              {submitting ? 'Creating account…' : 'Create account'}
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
            Already have an account?{' '}
            <Link
              to="/"
              className="font-semibold text-cobalt underline-offset-2 hover:underline focus-visible:underline"
            >
              Sign in
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
