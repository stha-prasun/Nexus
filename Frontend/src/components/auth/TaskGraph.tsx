import { type CSSProperties, useEffect } from 'react';

const PULSE_CYCLES: Array<[number, number]> = [
  [3.2, 2.2],
  [3.8, 2.9],
  [4.4, 3.4],
  [3.5, 2.5],
  [4.1, 3.1],
  [3.0, 3.7],
];

export const cssVars = (vars: Record<string, string>): CSSProperties =>
  vars as unknown as CSSProperties;

interface TaskGraphProps {
  active: boolean;
}

export function TaskGraph({ active }: TaskGraphProps) {
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

  return (
    <svg
      className={`graph${active ? ' active' : ''} pointer-events-none absolute inset-0 hidden h-full w-full lg:block`}
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
  );
}
