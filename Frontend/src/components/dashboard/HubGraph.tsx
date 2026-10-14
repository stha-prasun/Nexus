import type { CSSProperties } from 'react';
import type { Member } from '@/lib/dashboard';
import { initials, tint } from '@/lib/dashboard';

const W = 400;
const H = 240;
const CX = 200;
const CY = 120;

interface HubGraphProps {
  members: Member[];
}

/**
 * The organization as a hub, members as nodes. Animates on mount (the page
 * remounts it exactly when the design replays the graph: initial load,
 * member added/removed, organization created).
 */
export function HubGraph({ members }: HubGraphProps) {
  const shown = members.slice(0, 7);
  const extra = members.length - shown.length;

  const pos = shown.map((_, i) => {
    const angle = (i / shown.length) * Math.PI * 2 - Math.PI / 2 + 0.35;
    return [CX + 158 * Math.cos(angle), CY + 92 * Math.sin(angle)] as const;
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      role="img"
      aria-label={`${members.length} members connected to the organization`}
    >
      <g stroke="rgba(255,255,255,.5)" strokeWidth={1.5}>
        {pos.map(([x, y], i) => (
          <line
            key={`edge-${shown[i]?.email ?? i}`}
            className="g-edge"
            pathLength={1}
            style={{ '--d': `${0.2 + i * 0.08}s` } as CSSProperties}
            x1={CX}
            y1={CY}
            x2={x.toFixed(1)}
            y2={y.toFixed(1)}
          />
        ))}
      </g>
      <rect
        className="g-ring"
        x={CX - 30}
        y={CY - 30}
        width={60}
        height={60}
        fill="none"
        stroke="#fff"
        strokeWidth={1.5}
      />
      <rect x={CX - 30} y={CY - 30} width={60} height={60} fill="#FFD83D" />
      <g
        transform={`translate(${CX - 14} ${CY - 14}) scale(1.17)`}
        fill="none"
        stroke="#14183A"
        strokeWidth={1.8}
        strokeLinecap="round"
      >
        <path d="M12 8.5v3.5M12 12l-5.5 4M12 12l5.5 4" />
        <circle cx="12" cy="6" r="3" fill="#14183A" />
        <circle cx="5.5" cy="17.5" r="2.2" fill="#14183A" />
        <circle cx="18.5" cy="17.5" r="2.2" fill="#14183A" />
      </g>
      {shown.map((member, i) => {
        const point = pos[i];
        if (!point) return null;
        const [x, y] = point;
        return (
          <g
            key={member.email}
            className="g-node"
            style={{ '--d': `${0.7 + i * 0.08}s` } as CSSProperties}
          >
            <rect
              x={(x - 20).toFixed(1)}
              y={(y - 20).toFixed(1)}
              width={40}
              height={40}
              fill={tint(member.name)}
              {...(member.invited
                ? { stroke: '#fff', strokeWidth: 2, strokeDasharray: '4 3' }
                : {})}
            />
            <text
              x={x.toFixed(1)}
              y={(y + 4).toFixed(1)}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="#14183A"
              fontFamily="Figtree, sans-serif"
            >
              {initials(member.name)}
            </text>
          </g>
        );
      })}
      {extra > 0 ? (
        <text
          x={W - 14}
          y={H - 8}
          textAnchor="end"
          fontSize={12}
          fontWeight={600}
          fill="rgba(255,255,255,.8)"
          fontFamily="Figtree, sans-serif"
        >
          {`+${extra} more`}
        </text>
      ) : null}
    </svg>
  );
}
