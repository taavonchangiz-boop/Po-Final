import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';

export interface LogoProps {
  /** 'square' = logo.webp (static, transparent). 'full' = logo-full.webp. */
  variant?: 'square' | 'full';
  className?: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Official brand logo family (po/ assets — see audits/assets/ASSET-AUDIT.md).
 * - Default: transparent variants (logo.webp / logo-full.webp).
 * - logo-full.webp is an ANIMATED WebP; when prefers-reduced-motion is set we
 *   swap to the static logo-full-white-bg.webp. That variant has a BAKED white
 *   background, so it is rendered inside a white chip (used ONLY on light
 *   surfaces where no transparency is needed).
 */
export function Logo({ variant = 'square', className }: LogoProps) {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (variant === 'square') {
    return (
      <img
        src="/images/logo.webp"
        alt="پُست‌یار"
        width={36}
        height={36}
        className={cn('h-9 w-9', className)}
      />
    );
  }

  if (reducedMotion) {
    return (
      <span className="inline-flex items-center rounded-lg bg-white p-0.5">
        <img
          src="/images/logo-full-white-bg.webp"
          alt="پُست‌یار"
          width={110}
          height={60}
          className={cn('h-8 w-auto', className)}
        />
      </span>
    );
  }

  return (
    <img
      src="/images/logo-full.webp"
      alt="پُست‌یار"
      width={110}
      height={60}
      className={cn('h-8 w-auto', className)}
    />
  );
}
