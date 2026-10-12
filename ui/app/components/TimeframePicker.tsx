import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { ChevronDownIcon, ClockIcon, CalendarIcon } from "@dynatrace/strato-icons";

const RECENTLY_USED_KEY = "cio-overview-app:recent-timeframes";
const MAX_RECENT = 5;

export interface TimeframeOption {
  label: string;
  value: string;
  display: string;
}

const QUICK_OPTIONS: TimeframeOption[] = [
  { label: "Last 5 minutes",  value: "5m",   display: "-5m → Now"   },
  { label: "Last 30 minutes", value: "30m",  display: "-30m → Now"  },
  { label: "Last 1 hour",     value: "1h",   display: "-1h → Now"   },
  { label: "Last 2 hours",    value: "2h",   display: "-2h → Now"   },
  { label: "Last 24 hours",   value: "24h",  display: "-24h → Now"  },
  { label: "Last 7 days",     value: "7d",   display: "-7d → Now"   },
  { label: "Last 30 days",    value: "30d",  display: "-30d → Now"  },
  { label: "Month to date",   value: "MTD",  display: "MTD → Now"   },
];

function getLabel(value: string): string {
  return QUICK_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function loadRecent(): TimeframeOption[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTLY_USED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecent(option: TimeframeOption) {
  const prev = loadRecent().filter((o) => o.value !== option.value);
  localStorage.setItem(RECENTLY_USED_KEY, JSON.stringify([option, ...prev].slice(0, MAX_RECENT)));
}

interface TimeframePickerProps {
  value: string;
  onChange: (value: string) => void;
}

export const TimeframePicker: React.FC<TimeframePickerProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState(QUICK_OPTIONS.find((o) => o.value === value)?.display ?? `-${value} → Now`);
  const [recent, setRecent] = useState<TimeframeOption[]>(loadRecent);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = useCallback((opt: TimeframeOption) => {
    onChange(opt.value);
    saveRecent(opt);
    setRecent(loadRecent());
    setCustomInput(opt.display);
    setOpen(false);
  }, [onChange]);

  function applyCustom() {
    const raw = customInput.trim();
    const match = raw.match(/^-?(\d+[mhd])\s*(?:→.*)?$/i);
    if (!match) return;
    const v = match[1].toLowerCase();
    const opt = QUICK_OPTIONS.find((o) => o.value === v) ?? {
      label: v, value: v, display: `-${v} → Now`,
    };
    select(opt);
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <Button variant="default" onClick={() => setOpen((o) => !o)} style={{ minWidth: 140 }}>
        {getLabel(value)}
        <Button.Suffix><ChevronDownIcon /></Button.Suffix>
      </Button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 1000,
          minWidth: 340, background: "#1e2130", border: "1px solid #3a3f52",
          borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #3a3f52" }}>
            <div style={{ fontSize: 11, color: "#8b92a8", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
              Timeframe
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyCustom()}
                  style={{
                    width: "100%", background: "#141722", border: "1px solid #3a3f52",
                    borderRadius: 4, color: "#ffffff", padding: "6px 32px 6px 10px",
                    fontSize: 14, fontFamily: "monospace", boxSizing: "border-box", outline: "none",
                  }}
                />
                <CalendarIcon style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#8b92a8", width: 16, height: 16 }} />
              </div>
              <button onClick={applyCustom} style={{
                background: "#526cff", color: "#fff", border: "none", borderRadius: 4,
                padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                Apply
              </button>
            </div>
          </div>

          <div style={{ display: "flex" }}>
            <div style={{ flex: 1, padding: "8px 0", borderRight: recent.length > 0 ? "1px solid #3a3f52" : "none" }}>
              {QUICK_OPTIONS.map((opt) => (
                <button key={opt.value} onClick={() => select(opt)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  width: "100%", padding: "7px 16px",
                  background: opt.value === value ? "#2a3050" : "transparent",
                  border: "none", color: opt.value === value ? "#7c9dff" : "#c8cedf",
                  fontSize: 13, cursor: "pointer", textAlign: "left",
                }}
                  onMouseEnter={(e) => { if (opt.value !== value) (e.currentTarget as HTMLElement).style.background = "#232840"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = opt.value === value ? "#2a3050" : "transparent"; }}
                >
                  <span>{opt.label}</span>
                  <span style={{ color: "#5c6480", fontSize: 12, fontFamily: "monospace" }}>{opt.display}</span>
                </button>
              ))}
            </div>

            {recent.length > 0 && (
              <div style={{ width: 180, padding: "8px 0" }}>
                <div style={{ padding: "4px 16px 8px", fontSize: 11, color: "#8b92a8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
                  Recently used
                </div>
                {recent.map((opt) => (
                  <button key={opt.value} onClick={() => select(opt)} style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "7px 16px",
                    background: opt.value === value ? "#2a3050" : "transparent",
                    border: "none", color: opt.value === value ? "#7c9dff" : "#c8cedf",
                    fontSize: 13, cursor: "pointer", textAlign: "left",
                  }}
                    onMouseEnter={(e) => { if (opt.value !== value) (e.currentTarget as HTMLElement).style.background = "#232840"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = opt.value === value ? "#2a3050" : "transparent"; }}
                  >
                    <ClockIcon style={{ width: 14, height: 14, color: "#8b92a8", flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{opt.label}</span>
                    <span style={{ color: "#5c6480", fontSize: 12, fontFamily: "monospace" }}>{opt.display}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: "8px 16px", borderTop: "1px solid #3a3f52", fontSize: 12, color: "#5c6480" }}>
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </div>
        </div>
      )}
    </div>
  );
};
