import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Persian field label (rendered above the input). */
  label?: string;
  /** Persian hint (muted, below the input). */
  hint?: string;
  /** Persian validation error message (overrides hint, red). */
  error?: string;
  /** Text direction override: 'ltr' for phones/emails/amounts. Default inherits RTL. */
  dir?: 'rtl' | 'ltr' | 'auto';
  id?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, dir, className, id, required, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-neutral-700">
          {label}
          {required && <span className="text-red-600"> *</span>}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        dir={dir}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'focus-ring w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-neutral-900',
          'placeholder:text-neutral-400 transition-colors',
          error ? 'border-red-400' : 'border-neutral-200 hover:border-neutral-300',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
