import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/**
 * Toasts for things that just happened.
 *
 * The distinction that matters: a toast is for an **event** ("published"), an
 * inline notice is for a **state** ("this date is in the past"). Events pass and
 * should get out of the way; states persist until the operator fixes them, so
 * they must not vanish on a timer.
 *
 * Publishing notifies the whole club, so the confirmation should feel like
 * something happened rather than a line of text appearing halfway up the page.
 */

type Tone = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
  leaving?: boolean;
};

type ToastApi = {
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

// Errors linger: a message that disappears before it has been read is worse
// than no message, and an error usually needs acting on.
const DISMISS_MS: Record<Tone, number> = { success: 4200, info: 5000, error: 9000 };
const EXIT_MS = 220;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    // Mark leaving first so the exit animation can run, then unmount.
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), EXIT_MS);
  }, []);

  const push = useCallback(
    (tone: Tone, title: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((all) => [...all, { id, tone, title, detail }]);
      setTimeout(() => remove(id), DISMISS_MS[tone]);
    },
    [remove],
  );

  const api: ToastApi = {
    success: (title, detail) => push('success', title, detail),
    error: (title, detail) => push('error', title, detail),
    info: (title, detail) => push('info', title, detail),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/*
        aria-live so a screen-reader user hears the confirmation too — the
        animation is decoration, the announcement is the actual feedback.
      */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.tone}${toast.leaving ? ' leaving' : ''}`}
          >
            <span className="toast-icon" aria-hidden="true">
              {toast.tone === 'success' ? '✓' : toast.tone === 'error' ? '!' : 'i'}
            </span>
            <div className="toast-body">
              <div className="toast-title">{toast.title}</div>
              {toast.detail && <div className="toast-detail">{toast.detail}</div>}
            </div>
            <button
              className="toast-close"
              onClick={() => remove(toast.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
