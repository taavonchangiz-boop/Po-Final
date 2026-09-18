import { create } from 'zustand';

/**
 * Global UI state: auth modal, sidebar drawer, toasts.
 * Kept framework-agnostic (zustand) so any layer can push toasts / open modals.
 */

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

export type AuthModalMode = 'login' | 'register';

interface UiState {
  authModalOpen: boolean;
  authModalMode: AuthModalMode;
  sidebarOpen: boolean;
  toasts: ToastItem[];
  openAuthModal: (mode?: AuthModalMode) => void;
  closeAuthModal: () => void;
  setAuthModalMode: (mode: AuthModalMode) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  pushToast: (type: ToastType, message: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

export const useUiStore = create<UiState>((set, get) => ({
  authModalOpen: false,
  authModalMode: 'login',
  sidebarOpen: false,
  toasts: [],

  openAuthModal: (mode = 'login') => set({ authModalOpen: true, authModalMode: mode }),
  closeAuthModal: () => set({ authModalOpen: false }),
  setAuthModalMode: (mode) => set({ authModalMode: mode }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  pushToast: (type, message) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    const ttl = type === 'error' ? 7000 : 4500;
    window.setTimeout(() => get().dismissToast(id), ttl);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helper — usable outside React (e.g. api layer, feature actions). */
export function toast(type: ToastType, message: string): void {
  useUiStore.getState().pushToast(type, message);
}
