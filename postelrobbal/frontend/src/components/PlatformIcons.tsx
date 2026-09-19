import { useId } from 'react';

/**
 * Official-style simplified platform logos as inline SVG (Task 14-a).
 * Self-contained (no external CDNs), RTL-safe, crisp at any size.
 * - Telegram: blue circle #229ED9 + white paper plane
 * - Bale: dark blue rounded square + white chat bubble with signal waves
 * - Rubika: purple gradient rounded square + white rubik-tile emblem
 */

export function TelegramIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="تلگرام" className={className}>
      <circle cx="12" cy="12" r="10" fill="#229ED9" />
      <path
        fill="#ffffff"
        d="M17.1 7.9 15.4 16c-.13.58-.48.72-.97.45l-2.68-1.98-1.3 1.26c-.14.14-.27.27-.55.27l.2-2.78 5.05-4.56c.22-.2-.05-.3-.33-.12l-6.24 3.93-2.69-.84c-.58-.18-.6-.58.13-.86l10.5-4.05c.49-.18.92.12.76.9z"
      />
    </svg>
  );
}

export function BaleIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="بله" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#17337A" />
      {/* chat bubble with tail */}
      <path
        fill="#ffffff"
        d="M7.2 6.8h9.6c1.27 0 2.3 1.03 2.3 2.3v4.3c0 1.27-1.03 2.3-2.3 2.3h-5.5l-3.4 2.9a.55.55 0 0 1-.9-.42v-2.48h.2c-1.27 0-2.3-1.03-2.3-2.3V9.1c0-1.27 1.03-2.3 2.3-2.3z"
      />
      {/* signal waves */}
      <path
        d="M9.6 12.1a3.4 3.4 0 0 1 4.8 0"
        fill="none"
        stroke="#34C759"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M8.1 10.2a5.6 5.6 0 0 1 7.8 0"
        fill="none"
        stroke="#34C759"
        strokeWidth="1.35"
        strokeLinecap="round"
        opacity="0.65"
      />
      <circle cx="12" cy="13.6" r="1.05" fill="#34C759" />
    </svg>
  );
}

export function RubikaIcon({ size = 24, className }: { size?: number; className?: string }) {
  const gid = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="روبیکا" className={className}>
      <defs>
        <linearGradient id={`rubika-${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill={`url(#rubika-${gid})`} />
      {/* rubik-cube style tile emblem */}
      <g transform="rotate(6 12 12)">
        <rect x="6.4" y="6.4" width="5" height="5" rx="1.5" fill="#ffffff" />
        <rect x="12.6" y="6.4" width="5" height="5" rx="1.5" fill="#ffffff" opacity="0.8" />
        <rect x="6.4" y="12.6" width="5" height="5" rx="1.5" fill="#ffffff" opacity="0.8" />
        <rect x="12.6" y="12.6" width="5" height="5" rx="1.5" fill="#ffffff" opacity="0.55" />
      </g>
    </svg>
  );
}

/** Convenience map for strips/footers. */
export const PLATFORM_ICONS = {
  telegram: TelegramIcon,
  bale: BaleIcon,
  rubika: RubikaIcon,
} as const;
