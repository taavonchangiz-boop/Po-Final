import { useId, type CSSProperties } from 'react';

/**
 * Brand logo (Task 14-a): inline-SVG paper-plane mark on the brand gradient
 * (#6366f1 → #8b5cf6) + «پُست‌یار» wordmark rendered as crisp HTML text in
 * Vazirmatn. Replaces the old raster logo webp images everywhere.
 *
 * variant 'dark'  → for light backgrounds (dark wordmark)
 * variant 'light' → for dark backgrounds/footers (white wordmark)
 */
export function Logo({
  variant = 'dark',
  size = 36,
  withWordmark = true,
  wordmarkSize,
  className,
  style,
}: {
  variant?: 'dark' | 'light';
  /** Mark size in px. */
  size?: number;
  withWordmark?: boolean;
  wordmarkSize?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const gid = useId().replace(/:/g, '');
  const isLight = variant === 'light';
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(7, size * 0.24), ...style }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        role="img"
        aria-label="لوگوی پُست‌یار"
        style={{ display: 'block', flexShrink: 0 }}
      >
        <defs>
          <linearGradient id={`py-mark-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <rect x="1.5" y="1.5" width="45" height="45" rx="13" fill={`url(#py-mark-${gid})`} />
        {/* subtle top-left sheen */}
        <path d="M1.5 14.5 A13 13 0 0 1 14.5 1.5 H24 L14 20 Z" fill="#ffffff" opacity="0.14" />
        {/* paper plane */}
        <g transform="translate(7.2 7.2) scale(1.4)">
          <path
            d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      {withWordmark && (
        <span
          style={{
            fontSize: wordmarkSize ?? Math.round(size * 0.56),
            fontWeight: 900,
            lineHeight: 1.2,
            color: isLight ? '#ffffff' : 'var(--text)',
            letterSpacing: '-0.2px',
            whiteSpace: 'nowrap',
          }}
        >
          پُست‌یار
        </span>
      )}
    </span>
  );
}
