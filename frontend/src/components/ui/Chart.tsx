/**
 * Lightweight SVG charts — NO chart libraries.
 * Persian digit axis labels via the shared formatting kernel.
 * All charts expose role="img" + Persian aria-label.
 */
import { faCompact, faNumber } from '../../lib/format';

export interface ChartPoint {
  label: string;
  value: number;
}

const AXIS_COLOR = '#78716c';
const GRID_COLOR = '#e7e5e4';
const PRIMARY = '#0d9488';
const PRIMARY_DARK = '#0f766e';

function EmptyChart({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-card border border-dashed border-neutral-200 bg-neutral-50 text-sm text-neutral-400"
      style={{ height }}
    >
      داده‌ای برای نمایش نیست
    </div>
  );
}

function fmtAxis(v: number): string {
  return v >= 1000 ? faCompact(v) : faNumber(Math.round(v * 10) / 10);
}

/* ------------------------------- Bar chart ------------------------------- */

export interface BarChartProps {
  data: ChartPoint[];
  height?: number;
  ariaLabel?: string;
}

export function BarChart({ data, height = 220, ariaLabel = 'نمودار ستونی' }: BarChartProps) {
  if (data.length === 0) return <EmptyChart height={height} />;

  const W = 560;
  const H = height;
  const padTop = 14;
  const padBottom = 30;
  const padStartX = 48;
  const padEndX = 10;
  const plotW = W - padStartX - padEndX;
  const plotH = H - padTop - padBottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const bandW = plotW / data.length;
  const barW = Math.min(bandW * 0.62, 34);
  const x = (i: number) => padStartX + i * bandW + (bandW - barW) / 2;
  const y = (v: number) => padTop + plotH - (v / max) * plotH;
  const step = Math.ceil(data.length / 8);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="xMidYMid meet"
    >
      {[0, max / 2, max].map((tick, i) => (
        <g key={i}>
          <line
            x1={padStartX}
            x2={W - padEndX}
            y1={y(tick)}
            y2={y(tick)}
            stroke={GRID_COLOR}
            strokeWidth={1}
          />
          <text x={padStartX - 8} y={y(tick) + 4} fontSize={11} fill={AXIS_COLOR} textAnchor="end">
            {fmtAxis(tick)}
          </text>
        </g>
      ))}
      {data.map((d, i) => (
        <g key={i}>
          <rect
            x={x(i)}
            y={y(d.value)}
            width={barW}
            height={Math.max(padTop + plotH - y(d.value), 1)}
            rx={3}
            fill={PRIMARY}
          >
            <title>{`${d.label}: ${faNumber(d.value)}`}</title>
          </rect>
          {i % step === 0 && (
            <text
              x={x(i) + barW / 2}
              y={H - 10}
              fontSize={10}
              fill={AXIS_COLOR}
              textAnchor="middle"
            >
              {d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/* ------------------------------- Line chart ------------------------------- */

export interface LineChartProps {
  data: ChartPoint[];
  height?: number;
  ariaLabel?: string;
}

export function LineChart({ data, height = 220, ariaLabel = 'نمودار خطی' }: LineChartProps) {
  if (data.length === 0) return <EmptyChart height={height} />;

  const W = 560;
  const H = height;
  const padTop = 14;
  const padBottom = 30;
  const padStartX = 48;
  const padEndX = 10;
  const plotW = W - padStartX - padEndX;
  const plotH = H - padTop - padBottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const px = (i: number) =>
    padStartX + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const py = (v: number) => padTop + plotH - (v / max) * plotH;
  const points = data.map((d, i) => `${px(i)},${py(d.value)}`).join(' ');
  const area = `${padStartX},${padTop + plotH} ${points} ${px(data.length - 1)},${padTop + plotH}`;
  const step = Math.ceil(data.length / 8);

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="xMidYMid meet"
    >
      {[0, max / 2, max].map((tick, i) => (
        <g key={i}>
          <line
            x1={padStartX}
            x2={W - padEndX}
            y1={py(tick)}
            y2={py(tick)}
            stroke={GRID_COLOR}
            strokeWidth={1}
          />
          <text x={padStartX - 8} y={py(tick) + 4} fontSize={11} fill={AXIS_COLOR} textAnchor="end">
            {fmtAxis(tick)}
          </text>
        </g>
      ))}
      <polygon points={area} fill={PRIMARY} opacity={0.12} />
      <polyline
        points={points}
        fill="none"
        stroke={PRIMARY_DARK}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(d.value)} r={3} fill={PRIMARY_DARK}>
            <title>{`${d.label}: ${faNumber(d.value)}`}</title>
          </circle>
          {i % step === 0 && (
            <text x={px(i)} y={H - 10} fontSize={10} fill={AXIS_COLOR} textAnchor="middle">
              {d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/* --------------------------------- Donut --------------------------------- */

export interface DonutSegment {
  label: string;
  value: number;
  color?: string;
}

export interface DonutProps {
  segments: DonutSegment[];
  /** Persian label for the center total, e.g. 'کل ارسال‌ها'. */
  centerLabel?: string;
  size?: number;
  ariaLabel?: string;
}

const DEFAULT_COLORS = ['#0f766e', '#14b8a6', '#5eead4', '#f59e0b', '#a8a29e', '#134e4a'];

export function Donut({ segments, centerLabel, size = 180, ariaLabel = 'نمودار دایره‌ای' }: DonutProps) {
  const usable = segments.filter((s) => s.value > 0);
  if (usable.length === 0) return <EmptyChart height={size} />;

  const total = usable.reduce((sum, s) => sum + s.value, 0);
  const c = size / 2;
  const r = size * 0.36;
  const stroke = size * 0.13;
  const circumference = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <svg
        role="img"
        aria-label={ariaLabel}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle cx={c} cy={c} r={r} fill="none" stroke={GRID_COLOR} strokeWidth={stroke} />
        {usable.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * circumference;
          const offset = -acc * circumference;
          acc += frac;
          const color = s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
          return (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${c} ${c})`}
            >
              <title>{`${s.label}: ${faNumber(s.value)}`}</title>
            </circle>
          );
        })}
        <text x={c} y={c - 2} textAnchor="middle" fontSize={size * 0.13} fontWeight="700" fill="#1c1917">
          {faCompact(total)}
        </text>
        {centerLabel && (
          <text x={c} y={c + size * 0.11} textAnchor="middle" fontSize={size * 0.055} fill={AXIS_COLOR}>
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="space-y-2 text-sm">
        {usable.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-neutral-700">
            <span
              aria-hidden="true"
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ backgroundColor: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] }}
            />
            <span className="font-medium">{s.label}</span>
            <span className="text-neutral-500">
              {faNumber(s.value)}
              <span className="mx-1 text-xs">({faNumber(Math.round((s.value / total) * 100))}٪)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
