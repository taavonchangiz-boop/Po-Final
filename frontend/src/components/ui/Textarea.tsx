import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label?: string;
  hint?: string;
  error?: string;
  dir?: 'rtl' | 'ltr' | 'auto';
  id?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, dir, className, id, required, rows = 4, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? `textarea-${autoId}`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-neutral-700">
          {label}
          {required && <span className="text-red-600"> *</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        dir={dir}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'focus-ring w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-neutral-900',
          'placeholder:text-neutral-400 transition-colors resize-y',
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
