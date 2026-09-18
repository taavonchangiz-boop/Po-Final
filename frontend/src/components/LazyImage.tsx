import { useState, type ImgHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface LazyImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'> {
  src: string;
  /** Required — every image in Postyar carries a Persian alt text. */
  alt: string;
  wrapperClassName?: string;
}

/**
 * Lazy-loaded image with a neutral placeholder on failure.
 * loading=lazy + decoding=async are forced for performance.
 */
export function LazyImage({ src, alt, className, wrapperClassName, ...rest }: LazyImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={cn(
          'flex items-center justify-center rounded-xl bg-neutral-100 text-xs text-neutral-400',
          wrapperClassName,
          className,
        )}
      >
        تصویر در دسترس نیست
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
      {...rest}
    />
  );
}
