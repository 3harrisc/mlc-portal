"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import Icon from "./Icon";

interface Toast {
  id: number;
  message: string;
  kind: "ok" | "err";
}

interface ToastValue {
  showToast: (message: string, kind?: "ok" | "err") => void;
}

const ToastContext = createContext<ToastValue>({
  showToast: () => {},
});

const VISIBLE_MS = 3000;
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, kind: "ok" | "err" = "ok") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, VISIBLE_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="toast"
              style={t.kind === "err" ? { background: "var(--err)" } : undefined}
            >
              <Icon name={t.kind === "err" ? "x" : "check"} size={14} />
              {t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  return useContext(ToastContext);
}
