import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface TableProps {
  children: ReactNode;
  className?: string;
  /** Accessible caption (Persian) for screen readers. */
  caption?: string;
}

export function Table({ children, className, caption }: TableProps) {
  return (
    <div className="overflow-x-auto rounded-card border border-neutral-200 bg-white">
      <table className={cn('w-full min-w-max text-sm', className)}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-neutral-50 text-neutral-600">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-neutral-100">{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn('transition-colors hover:bg-neutral-50/60', className)}>{children}</tr>;
}

export function TH({ children, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('px-4 py-3 text-start text-xs font-semibold whitespace-nowrap', className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ children, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3 align-middle text-neutral-700', className)} {...rest}>
      {children}
    </td>
  );
}
