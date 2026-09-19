import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { faNumber } from '../../lib/format';
import { cn } from '../../lib/cn';

/**
 * Shared building blocks for the redesigned landing page (task 10-b).
 * Zero new dependencies: IntersectionObserver + rAF + CSS keyframes only.
 * All motion is disabled globally under `prefers-reduced-motion`
 * (see the override at the bottom of index.css).
 */

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------------------------------------------ */
/* Smooth in-page anchor scrolling (respects the floating header)      */
/* ------------------------------------------------------------------ */

export function scrollToAnchor(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  window.history.replaceState(null, '', `#${id}`);
}

/* ------------------------------------------------------------------ */
/* Reveal-on-scroll wrapper                                            */
/* ------------------------------------------------------------------ */

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Stagger delay in ms (CSS var, consumed by .lp-reveal). */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn('lp-reveal', visible && 'lp-reveal-visible', className)}
      style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Animated Persian counter (count-up on scroll into view)             */
/* ------------------------------------------------------------------ */

export function CountUp({
  to,
  decimals = 0,
  duration = 1800,
  className,
}: {
  to: number;
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const format = (value: number): string => faNumber(Number(value.toFixed(decimals)), { group: true });

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      el.textContent = format(to);
      return;
    }

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - t0) / duration);
          const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress); // easeOutExpo
          el.textContent = format(to * eased);
          if (progress < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, decimals, duration]);

  return (
    <span ref={ref} className={className}>
      {faNumber(0, { group: true })}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Scroll progress hairline (top of viewport, RTL origin)              */
/* ------------------------------------------------------------------ */

export function ScrollProgress() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5">
      <div
        ref={ref}
        className="h-full origin-right bg-gradient-to-l from-primary-400 via-emerald-400 to-accent-400"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hover tilt hook (disabled for touch + reduced motion)               */
/* ------------------------------------------------------------------ */

export function useTilt<T extends HTMLElement>(maxDeg = 5) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || window.matchMedia('(hover: none)').matches) return;

    let raf = 0;
    const onMove = (event: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `perspective(1100px) rotateX(${(-py * maxDeg).toFixed(2)}deg) rotateY(${(px * maxDeg).toFixed(2)}deg) scale3d(1.012, 1.012, 1.012)`;
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = '';
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [maxDeg]);

  return ref;
}

/* ------------------------------------------------------------------ */
/* Section heading                                                     */
/* ------------------------------------------------------------------ */

export function SectionHead({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: string;
}) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="inline-flex items-center gap-2 rounded-full border border-primary-400/25 bg-primary-400/10 px-4 py-1.5 text-xs font-bold text-primary-300">
        <span aria-hidden="true" className="lp-pulse-dot size-1.5 rounded-full bg-primary-300" />
        {eyebrow}
      </p>
      <h2 className="mt-4 text-2xl font-bold leading-snug text-stone-50 sm:text-3xl lg:text-4xl">{title}</h2>
      {description && (
        <p className="mt-4 text-sm leading-7 text-stone-400 lg:text-base lg:leading-8">{description}</p>
      )}
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* Messenger brand icons — hand-crafted inline SVGs (48×48 viewBox).   */
/* Telegram: official paper-plane in brand-blue circle.                */
/* Bale: white speech bubble + paper plane on brand-green circle.      */
/* Rubika: violet gem (faceted hexagon) + play motif.                  */
/* ------------------------------------------------------------------ */

export function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id="lp-tg-grad" x1="12" y1="2" x2="36" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2AABEE" />
          <stop offset="1" stopColor="#229ED9" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#lp-tg-grad)" />
      {/* paper plane (nose up-right, official orientation): body, fold shadow, tail */}
      <g transform="rotate(-30 24 24) translate(48 0) scale(-1 1)">
        <polygon points="11,24.6 37.3,13.4 30.4,35.9 23.3,29.3" fill="#FFFFFF" />
        <polygon points="23.3,29.3 30.4,35.9 27.6,26.6" fill="#D6E9F5" />
        <polygon points="19.9,33.1 19.2,38.9 23.3,29.3" fill="#FFFFFF" />
      </g>
    </svg>
  );
}

export function BaleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id="lp-bale-grad" x1="10" y1="4" x2="40" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4DC97B" />
          <stop offset="1" stopColor="#1FA05A" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#lp-bale-grad)" />
      {/* speech bubble with tail */}
      <path
        d="M24 13.5c6.6 0 11.5 3.8 11.5 9s-4.9 9-11.5 9c-.9 0-1.8-.07-2.65-.2L15.5 35l1.1-4.9C14.4 28.6 12.5 26 12.5 22.5c0-5.2 4.9-9 11.5-9Z"
        fill="#FFFFFF"
      />
      {/* paper plane inside the bubble */}
      <polygon points="19.5,26.3 31.5,17.8 26.9,28.6 23.6,25.2 19.5,26.3" fill="#1FA05A" />
      <polygon points="23.6,25.2 26.9,28.6 25.4,24.2" fill="#BFE6CE" />
    </svg>
  );
}

export function RubikaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id="lp-rub-grad" x1="12" y1="2" x2="36" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A78BFA" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id="lp-rub-gem" x1="16" y1="12" x2="32" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#DDD6FE" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill="url(#lp-rub-grad)" />
      {/* faceted gem (hexagonal silhouette) */}
      <polygon points="24,11 34.5,17.5 34.5,28.5 24,37 13.5,28.5 13.5,17.5" fill="url(#lp-rub-gem)" />
      <polygon points="24,11 34.5,17.5 24,24 13.5,17.5" fill="#FFFFFF" opacity="0.55" />
      <polygon points="24,24 34.5,17.5 34.5,28.5" fill="#C4B5FD" opacity="0.7" />
      {/* play motif */}
      <polygon points="21.4,20.4 29.2,24 21.4,27.6" fill="#6D28D9" />
    </svg>
  );
}
