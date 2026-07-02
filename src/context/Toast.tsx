import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { Icon } from "../lib/icons";

const Ctx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout((toast as unknown as { _t?: number })._t);
    (toast as unknown as { _t?: number })._t = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      {msg && (
        <div className="toast">
          <span style={{ color: "var(--mint)" }}><Icon name="bolt" size={16} fill /></span>{msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
