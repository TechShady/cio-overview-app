import React, { createContext, useContext, useState, useEffect } from "react";
import { useAppState, useSetAppState } from "@dynatrace-sdk/react-hooks";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
export const DEFAULTS = {
  appNameFilter: "",
  loginActionPattern: "login",
  balanceActionPattern: "balance",
  transferActionPattern: "transfer",
  confirmActionPattern: "confirm",
  avgTransactionValueUSD: 500,
  monthlyCloudBudgetK: 400,
  monthlyInfraCostK: 200,
  serviceSlaTargetPct: 99.9,
  serviceNameFilter: "",
  aiAssistEnabled: true,
  dtIntelligenceEnabled: false,
};

export type Settings = typeof DEFAULTS;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
interface SettingsContextValue {
  settings: Settings;
  saveSettings: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const STATE_KEY = "cio-overview:settings";

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const saved = useAppState({ key: STATE_KEY });
  const { execute: saveState } = useSetAppState();

  useEffect(() => {
    const raw = saved.data?.value as string | undefined;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setSettings({ ...DEFAULTS, ...parsed });
        }
      } catch { /* ignore */ }
    }
  }, [saved.data?.value]);

  const saveSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveState({ key: STATE_KEY, body: { value: JSON.stringify(next) } });
  };

  return (
    <SettingsContext.Provider value={{ settings, saveSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
};
