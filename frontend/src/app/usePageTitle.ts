import { useEffect } from 'react';

/**
 * Persian document.title per route. Appended with the brand suffix so the tab
 * always shows e.g. «کانال‌ها | پُست‌یار». Restores nothing on unmount (the next
 * route always sets its own title).
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | پُست‌یار`;
  }, [title]);
}
