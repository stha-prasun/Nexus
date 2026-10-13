import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

const PULSE_CYCLES: Array<[number, number]> = [
  [3.2, 2.2],
  [3.8, 2.9],
  [4.4, 3.4],
  [3.5, 2.5],
  [4.1, 3.1],
  [3.0, 3.7],
];

const cssVars = (vars: Record<string, string>): CSSProperties =>
  vars as unknown as CSSProperties;

export function LoginPage() {
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

  // Strike-through lines match each label's real width once the font loads
  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      document.querySelectorAll<SVGTextElement>('.strike').forEach((line) => {
        const targetId = line.dataset.for;
        const text = targetId
          ? (document.getElementById(targetId) as SVGTextElement | null)
          : null;
        if (!text) return;
        const x1 = Number(line.getAttribute('x1'));
        line.setAttribute('x2', String(x1 + text.getComputedTextLength()));
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Data pulses travel from each task into the panel (skipped for reduced motion)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const group = document.getElementById('pulses');
    if (!group) return;
    const circles = PULSE_CYCLES.map(([dur, begin], i) => {
      const circle = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle',
      );
      circle.setAttribute('r', '3.5');
      circle.setAttribute('opacity', '0');
      circle.innerHTML = `<animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keyPoints="0;1" keySplines=".45 0 .55 1"><mpath href="#e${i + 1}"/></animateMotion><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.8;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`;
      group.appendChild(circle);
      return circle;
    });
    return () => {
      circles.forEach((circle) => {
        circle.remove();
      });
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
    } else if (password.length < 8) {
      message = 'Your password needs at least 8 characters.';
    }
    setErrorMessage(message);
    if (message) {
      triggerShake();
      return;
    }
    // Demo loading state: replace with your real auth call
    setSubmitting(true);
    console.log('Submit', { email, remember });
    window.setTimeout(() => setSubmitting(false), 1500);
  };

  return (
    <main className="canvas relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-4 font-sans text-ink antialiased">
      {/* ===== Task graph (decorative, desktop only) ===== */}
      <svg
        className={`graph${graphActive ? ' active' : ''} pointer-events-none absolute inset-0 hidden h-full w-full lg:block`}
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <g
          className="edges"
          fill="none"
          stroke="rgba(255,255,255,.5)"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path
            id="e1"
            className="edge-out"
            pathLength="1"
            style={cssVars({ '--d': '0.3s' })}
            d="M290 144 C450 144 520 450 720 450"
          />
          <path
            id="e2"
            className="edge-out"
            pathLength="1"
            style={cssVars({ '--d': '0.4s' })}
            d="M360 424 C500 424 600 450 720 450"
          />
          <path
            id="e3"
            className="edge-out"
            pathLength="1"
            style={cssVars({ '--d': '0.5s' })}
            d="M310 714 C470 714 540 450 720 450"
          />
          <path
            id="e4"
            className="edge-out"
            pathLength="1"
            style={cssVars({ '--d': '0.35s' })}
            d="M1150 174 C990 174 920 450 720 450"
          />
          <path
            id="e5"
            className="edge-out"
            pathLength="1"
            style={cssVars({ '--d': '0.45s' })}
            d="M1050 454 C920 454 820 450 720 450"
          />
          <path
            id="e6"
            className="edge-out"
            pathLength="1"
            style={cssVars({ '--d': '0.55s' })}
            d="M1130 724 C970 724 900 450 720 450"
          />
          <path
            className="edge-in"
            pathLength="1"
            style={cssVars({ '--d': '1.6s' })}
            d="M175 168 C175 290 245 280 245 400"
          />
          <path
            className="edge-in"
            pathLength="1"
            style={cssVars({ '--d': '1.7s' })}
            d="M195 690 C195 580 245 560 245 448"
          />
          <path
            className="edge-in"
            pathLength="1"
            style={cssVars({ '--d': '1.65s' })}
            d="M1265 198 C1265 320 1165 310 1165 430"
          />
          <path
            className="edge-in"
            pathLength="1"
            style={cssVars({ '--d': '1.75s' })}
            d="M1245 700 C1245 590 1165 570 1165 478"
          />
        </g>
        <g id="pulses" fill="#FFD83D" />
        <g className="chip" style={cssVars({ '--d': '1.15s' })}>
          <rect x="60" y="120" width="230" height="48" rx="6" fill="#fff" />
          <circle cx="84" cy="144" r="9" fill="#FFD83D" />
          <path
            className="check"
            pathLength="1"
            style={cssVars({ '--c': '1.55s' })}
            d="M80 144.5l3 3 5-6"
            stroke="#14183A"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text className="t" x="104" y="149">
            Ship onboarding v2
          </text>
          <circle cx="264" cy="144" r="11" fill="#EEF0F8" />
          <text className="av" x="264" y="148">
            MK
          </text>
        </g>
        <g className="chip" style={cssVars({ '--d': '1.25s' })}>
          <rect x="130" y="400" width="230" height="48" rx="6" fill="#fff" />
          <g className="s-out" style={cssVars({ '--t': '3.4s' })}>
            <circle
              cx="154"
              cy="424"
              r="8"
              fill="none"
              stroke="#1F2FE0"
              strokeWidth="2"
            />
            <path d="M154 416a8 8 0 010 16z" fill="#1F2FE0" />
          </g>
          <g className="s-in" style={cssVars({ '--t': '3.4s' })}>
            <circle
              className="ripple"
              cx="154"
              cy="424"
              r="9"
              fill="none"
              stroke="#FFD83D"
              strokeWidth="2"
            />
            <circle cx="154" cy="424" r="9" fill="#FFD83D" />
            <path
              d="M150 424.5l3 3 5-6"
              stroke="#14183A"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <text
            id="tB"
            className="t lbl"
            style={cssVars({ '--t': '3.4s' })}
            x="174"
            y="429"
          >
            Review pricing copy
          </text>
          <line
            className="strike"
            data-for="tB"
            pathLength="1"
            x1="174"
            x2="320"
            y1="424.5"
            y2="424.5"
            stroke="#5A6080"
            strokeWidth="1.5"
            style={cssVars({ '--t': '3.4s' })}
          />
          <circle cx="334" cy="424" r="11" fill="#EEF0F8" />
          <text className="av" x="334" y="428">
            JT
          </text>
        </g>
        <g className="chip" style={cssVars({ '--d': '1.35s' })}>
          <rect x="80" y="690" width="230" height="48" rx="6" fill="#fff" />
          <g className="s-out" style={cssVars({ '--t': '3.9s' })}>
            <circle
              cx="104"
              cy="714"
              r="8"
              fill="none"
              stroke="#B5BAD6"
              strokeWidth="2"
            />
          </g>
          <g className="s-in" style={cssVars({ '--t': '3.9s' })}>
            <circle
              cx="104"
              cy="714"
              r="8"
              fill="none"
              stroke="#1F2FE0"
              strokeWidth="2"
            />
            <path d="M104 706a8 8 0 010 16z" fill="#1F2FE0" />
          </g>
          <text className="t" x="124" y="719">
            Plan Q4 roadmap
          </text>
          <circle cx="284" cy="714" r="11" fill="#EEF0F8" />
          <text className="av" x="284" y="718">
            AS
          </text>
        </g>
        <g className="chip" style={cssVars({ '--d': '1.2s' })}>
          <rect x="1150" y="150" width="230" height="48" rx="6" fill="#fff" />
          <g className="s-out" style={cssVars({ '--t': '5.6s' })}>
            <circle
              cx="1174"
              cy="174"
              r="8"
              fill="none"
              stroke="#1F2FE0"
              strokeWidth="2"
            />
            <path d="M1174 166a8 8 0 010 16z" fill="#1F2FE0" />
          </g>
          <g className="s-in" style={cssVars({ '--t': '5.6s' })}>
            <circle
              className="ripple"
              cx="1174"
              cy="174"
              r="9"
              fill="none"
              stroke="#FFD83D"
              strokeWidth="2"
            />
            <circle cx="1174" cy="174" r="9" fill="#FFD83D" />
            <path
              d="M1170 174.5l3 3 5-6"
              stroke="#14183A"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <text
            id="tD"
            className="t lbl"
            style={cssVars({ '--t': '5.6s' })}
            x="1194"
            y="179"
          >
            Fix checkout timeout
          </text>
          <line
            className="strike"
            data-for="tD"
            pathLength="1"
            x1="1194"
            x2="1340"
            y1="174.5"
            y2="174.5"
            stroke="#5A6080"
            strokeWidth="1.5"
            style={cssVars({ '--t': '5.6s' })}
          />
          <circle cx="1354" cy="174" r="11" fill="#EEF0F8" />
          <text className="av" x="1354" y="178">
            RP
          </text>
        </g>
        <g className="chip" style={cssVars({ '--d': '1.3s' })}>
          <rect x="1050" y="430" width="230" height="48" rx="6" fill="#fff" />
          <circle cx="1074" cy="454" r="9" fill="#FFD83D" />
          <path
            className="check"
            pathLength="1"
            style={cssVars({ '--c': '1.65s' })}
            d="M1070 454.5l3 3 5-6"
            stroke="#14183A"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text className="t" x="1094" y="459">
            Update API docs
          </text>
          <circle cx="1254" cy="454" r="11" fill="#EEF0F8" />
          <text className="av" x="1254" y="458">
            LW
          </text>
        </g>
        <g className="chip" style={cssVars({ '--d': '1.4s' })}>
          <rect x="1130" y="700" width="230" height="48" rx="6" fill="#fff" />
          <g className="s-out" style={cssVars({ '--t': '6.1s' })}>
            <circle
              cx="1154"
              cy="724"
              r="8"
              fill="none"
              stroke="#B5BAD6"
              strokeWidth="2"
            />
          </g>
          <g className="s-in" style={cssVars({ '--t': '6.1s' })}>
            <circle
              cx="1154"
              cy="724"
              r="8"
              fill="none"
              stroke="#1F2FE0"
              strokeWidth="2"
            />
            <path d="M1154 716a8 8 0 010 16z" fill="#1F2FE0" />
          </g>
          <text className="t" x="1174" y="729">
            Hire design lead
          </text>
          <circle cx="1334" cy="724" r="11" fill="#EEF0F8" />
          <text className="av" x="1334" y="728">
            MK
          </text>
        </g>
      </svg>

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
            <a
              // biome-ignore lint/a11y/useValidAnchor: placeholder link, matches original design
              href="#"
              className="font-semibold text-cobalt underline-offset-2 hover:underline focus-visible:underline"
            >
              Create one
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
