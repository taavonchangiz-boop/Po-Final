import { useState } from 'react';
import { faCompact, faNumber } from '../../lib/format';
import { faDayLabel, faDayLongLabel } from './analyticsParts';

/**
 * Daily activity chart (feedback item 12) — RTL time axis + rich hover.
 *
 *  - RTL ordering: the backend series is oldest-first; the chart REVERSES it so
 *    the newest day sits on the LEFT and the oldest on the RIGHT — the natural
 *    reading order for a Persian (RTL) audience. Axis labels follow their bands
 *    automatically, so axis and tooltip always describe the same day.
 *  - Rich tooltip: for the hovered day it shows the Jalali date (Persian
 *    digits), a per-event-type count (ارسال موفق / ارسال ناموفق) with a mini
 *    proportional breakdown bar, and the day total.
 *  - Performance: hand-rolled SVG (no chart library), one `number | null`
 *    hover state, ≤31 bands — tooltip renders by index lookup, zero effects.
 *
 * Colors mirror the app tokens: teal = success (Chart.tsx PRIMARY), red-600 =
 * failure (Badge danger family).
 */

export interface DailyActivityPoint {
  date?: string;
  sent?: number;
  failed?: number;
}

interface DailyActivityChartProps {
  /** Backend series (oldest-first); reversed internally for RTL rendering. */
  series: DailyActivityPoint[];
  height?: number;
  ariaLabel?: string;
}

const AXIS_COLOR = '#78716c';
const GRID_COLOR = '#e7e5e4';
const SENT_COLOR = '#0d9488';
const SENT_DARK = '#0f766e';
const FAILED_COLOR = '#dc2626';

function fmtAxis(v: number): string {
  return v >= 1000 ? faCompact(v) : faNumber(Math.round(v * 10) / 10);
}

export default function DailyActivityChart({ series, height = 240, ariaLabel = 'نمودار فعالیت روزانه' }: DailyActivityChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  // RTL: reverse the oldest-first backend series → index 0 (leftmost) = newest.
  const points: Array<{ day: string; sent: number; failed: number }> = [...series]
    .reverse()
    .map((p) => ({ day: p.date ?? '', sent: p.sent ?? 0, failed: p.failed ?? 0 }));

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-card border border-dashed border-neutral-200 bg-neutral-50 text-sm text-neutral-400"
        style={{ height }}
      >
        داده‌ای برای نمایش نیست
      </div>
    );
  }

  const W = 560;
  const H = height;
  const padTop = 14;
  const padBottom = 30;
  const padStartX = 48;
  const padEndX = 10;
  const plotW = W - padStartX - padEndX;
  const plotH = H - padTop - padBottom;
  const max = Math.max(...points.map((p) => Math.max(p.sent, p.failed)), 1);
  const bandW = plotW / points.length;
  const barW = Math.min(bandW * 0.28, 16);
  const bandX = (i: number) => padStartX + i * bandW;
  const y = (v: number) => padTop + plotH - (v / max) * plotH;
  const step = Math.ceil(points.length / 8);

  const hovered = hover !== null ? points[hover] : null;
  // Tooltip anchor: band center → percent of viewBox width, clamped so the card
  // never overflows the chart frame. translateX(-50%) centers it on the anchor.
  const tooltipPct =
    hover === null
      ? 50
      : Math.min(88, Math.max(12, ((bandX(hover) + bandW / 2) / W) * 100));
  const tooltipMax = hovered !== null ? Math.max(hovered.sent, hovered.failed, 1) : 1;

  return (
    <div>
      {/* legend */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-neutral-600">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ backgroundColor: SENT_COLOR }} />
            ارسال موفق
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ backgroundColor: FAILED_COLOR }} />
            ارسال ناموفق
          </span>
        </div>
        <span className="text-[10px] text-neutral-400">قدیمی‌ترین روز در سمت راست، جدیدترین در سمت چپ</span>
      </div>

      <div
        className="relative"
        onMouseLeave={() => setHover(null)}
      >
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* grid + y axis */}
          {[0, max / 2, max].map((tick, i) => (
            <g key={i}>
              <line x1={padStartX} x2={W - padEndX} y1={y(tick)} y2={y(tick)} stroke={GRID_COLOR} strokeWidth={1} />
              <text x={padStartX - 8} y={y(tick) + 4} fontSize={11} fill={AXIS_COLOR} textAnchor="end">
                {fmtAxis(tick)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const sentH = p.sent > 0 ? padTop + plotH - y(p.sent) : 0;
            const failedH = p.failed > 0 ? padTop + plotH - y(p.failed) : 0;
            const midX = bandX(i) + bandW / 2;
            return (
              <g key={p.day || i}>
                {hover === i && (
                  <rect
                    x={bandX(i)}
                    y={padTop}
                    width={bandW}
                    height={plotH}
                    fill={SENT_DARK}
                    opacity={0.07}
                    rx={4}
                  />
                )}
                {/* grouped bars: sent (right bar) + failed (left bar) inside the band */}
                {p.sent > 0 && (
                  <rect
                    x={midX + 1}
                    y={y(p.sent)}
                    width={barW}
                    height={sentH}
                    rx={2.5}
                    fill={SENT_COLOR}
                  >
                    <title>{`${faDayLongLabel(p.day)} — ارسال موفق: ${faNumber(p.sent)}`}</title>
                  </rect>
                )}
                {p.failed > 0 && (
                  <rect
                    x={midX - barW - 1}
                    y={y(p.failed)}
                    width={barW}
                    height={failedH}
                    rx={2.5}
                    fill={FAILED_COLOR}
                  >
                    <title>{`${faDayLongLabel(p.day)} — ارسال ناموفق: ${faNumber(p.failed)}`}</title>
                  </rect>
                )}
                {i % step === 0 && p.day !== '' && (
                  <text x={midX} y={H - 10} fontSize={10} fill={AXIS_COLOR} textAnchor="middle">
                    {faDayLabel(p.day)}
                  </text>
                )}
                {/* transparent hover band (covers grid + bars, keeps hover stable) */}
                <rect
                  x={bandX(i)}
                  y={0}
                  width={bandW}
                  height={H}
                  fill="transparent"
                  aria-hidden="true"
                  onMouseEnter={() => setHover(i)}
                  onTouchStart={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>

        {/* rich hover tooltip — pointer-events-none so it never blocks the
            next band's mouseenter; hiding happens on the wrapper's leave */}
        {hovered !== null && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 w-44 -translate-x-1/2 rounded-xl border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur-sm"
            style={{ left: `${tooltipPct}%`, top: 4 }}
            role="status"
          >
            <p className="border-b border-neutral-100 pb-1.5 text-center text-xs font-bold text-neutral-800">
              {hovered.day !== '' ? faDayLongLabel(hovered.day) : '—'}
            </p>
            <ul className="mt-2 space-y-2">
              <li>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-neutral-600">
                    <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ backgroundColor: SENT_COLOR }} />
                    موفق
                  </span>
                  <span className="font-bold text-neutral-900">{faNumber(hovered.sent)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(hovered.sent / tooltipMax) * 100}%`, backgroundColor: SENT_COLOR }}
                  />
                </div>
              </li>
              <li>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-neutral-600">
                    <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ backgroundColor: FAILED_COLOR }} />
                    ناموفق
                  </span>
                  <span className="font-bold text-neutral-900">{faNumber(hovered.failed)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(hovered.failed / tooltipMax) * 100}%`, backgroundColor: FAILED_COLOR }}
                  />
                </div>
              </li>
            </ul>
            <p className="mt-2 border-t border-neutral-100 pt-1.5 text-center text-[11px] text-neutral-500">
              مجموع: <span className="font-bold text-neutral-800">{faNumber(hovered.sent + hovered.failed)}</span> ارسال
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
