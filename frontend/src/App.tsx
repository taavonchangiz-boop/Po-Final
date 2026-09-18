import { useEffect } from 'react';
import AppRouter from './app/router';
import { useUiStore } from './store/ui';

/**
 * Application root: wires the router and the global unauthorized handler.
 * Providers (QueryClientProvider, BrowserRouter) and hosts (Toaster,
 * AuthModal) live in main.tsx around this component.
 */
export default function App() {
  useEffect(() => {
    function onUnauthorized() {
      useUiStore.getState().openAuthModal('login');
    }
    window.addEventListener('postyar:unauthorized', onUnauthorized);
    return () => window.removeEventListener('postyar:unauthorized', onUnauthorized);
  }, []);

  return <AppRouter />;
}
