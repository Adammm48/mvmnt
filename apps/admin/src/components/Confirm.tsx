import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Asking "are you sure?" without window.confirm.
 *
 * window.confirm looks like it works and then quietly does not: browsers
 * suppress it in embedded and automated contexts, and Chrome blocks repeat
 * dialogs from the same page. When it is suppressed it returns false, so the
 * caller reads "the operator said no" and does nothing at all — the button
 * appears dead. That is exactly what happened to "Make organiser".
 *
 * The mobile app hit the same class of bug from a different direction
 * (react-native-web's Alert is literally an empty function) and it was solved
 * the same way there: confirmation is part of the app, not something asked of
 * the browser.
 */

type Request = {
  title: string;
  message: string;
  confirmLabel: string;
  /** `danger` for anything destructive or hard to undo. */
  tone?: 'danger' | 'normal';
};

type ConfirmApi = (request: Request) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const ask = useCallback<ConfirmApi>((next) => {
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setRequest(null);
  }, []);

  // Escape cancels. A modal with no keyboard way out is a trap, and the safe
  // answer to "are you sure?" is always no.
  useEffect(() => {
    if (!request) return;
    confirmButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, settle]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request && (
        <div className="modal-backdrop" onClick={() => settle(false)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-title">{request.title}</h3>
            {/* pre-wrap so a caller can separate the warning from the
                description with a blank line, which is most of what makes
                these readable. */}
            <p style={{ whiteSpace: 'pre-wrap' }}>{request.message}</p>
            <div className="modal-actions">
              <button onClick={() => settle(false)}>Cancel</button>
              <button
                ref={confirmButton}
                className={request.tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => settle(true)}
              >
                {request.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmApi {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider');
  return context;
}
