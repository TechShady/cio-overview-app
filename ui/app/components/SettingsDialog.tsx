import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { useSettings, DEFAULTS } from "../SettingsContext";

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <div
    role="switch" aria-checked={checked} tabIndex={0}
    onClick={() => onChange(!checked)}
    onKeyDown={(e) => e.key === " " && onChange(!checked)}
    style={{ width: 40, height: 22, borderRadius: 11, padding: 2, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", background: checked ? "#526cff" : "#3a3f52", transition: "background 0.2s" }}
  >
    <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", transform: checked ? "translateX(18px)" : "translateX(0)", transition: "transform 0.2s" }} />
  </div>
);

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, hint, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <label style={{ fontSize: 12, fontWeight: 600, color: "#c8cedf" }}>{label}</label>
    {hint && <div style={{ fontSize: 11, color: "#5c6480" }}>{hint}</div>}
    {children}
  </div>
);

const inputStyle: React.CSSProperties = {
  background: "#0d0f1a",
  border: "1px solid #3a3f52",
  borderRadius: 4,
  color: "#ffffff",
  padding: "6px 10px",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export const SettingsDialog: React.FC = () => {
  const { settings, saveSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(settings);

  function handleOpen() {
    setDraft(settings);
    setOpen(true);
  }

  function handleSave() {
    saveSettings(draft);
    setOpen(false);
  }

  function set(key: keyof typeof DEFAULTS, value: string | number | boolean) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  if (!open) {
    return (
      <Button variant="default" onClick={handleOpen}>
        ⚙ Settings
      </Button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 999,
        }}
      />

      {/* Dialog */}
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        zIndex: 1000, background: "#1a1d2e", border: "1px solid #3a3f52", borderRadius: 10,
        boxShadow: "0 16px 48px rgba(0,0,0,0.7)", width: 520, maxHeight: "85vh", overflow: "auto",
      }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #3a3f52", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#e8eaf0" }}>CIO Overview Settings</div>
            <div style={{ fontSize: 12, color: "#5c6480", marginTop: 2 }}>Configure entity names and financial parameters</div>
          </div>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#8b92a8", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* ── AI Features ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#526cff", marginBottom: 12 }}>
              AI Features
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* AI Assist toggle */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
                <Toggle checked={draft.aiAssistEnabled} onChange={(v) => set("aiAssistEnabled", v)} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaf0" }}>AI Assist</div>
                  <div style={{ fontSize: 12, color: "#5c6480", marginTop: 3, lineHeight: 1.5 }}>
                    Rule-based analysis computed instantly from live Dynatrace data. Deterministic — the same metric values always produce the same insights. No external AI calls, no latency, works offline. Best for reliable, always-on insights.
                  </div>
                </div>
              </div>
              {/* Dynatrace Intelligence toggle */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)" }}>
                <Toggle checked={draft.dtIntelligenceEnabled} onChange={(v) => set("dtIntelligenceEnabled", v)} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e8eaf0" }}>Dynatrace Intelligence</div>
                  <div style={{ fontSize: 12, color: "#5c6480", marginTop: 3, lineHeight: 1.5 }}>
                    Generative analysis via Davis CoPilot — Dynatrace's built-in AI model. Interprets your live telemetry with natural language reasoning for nuanced, context-aware insights. Requires the <code style={{ background: "rgba(255,255,255,0.07)", padding: "1px 4px", borderRadius: 3 }}>davis-copilot:conversations:execute</code> scope and adds 2–5s latency per tab.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RUM / Application ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#526cff", marginBottom: 12 }}>
              RUM &amp; Applications
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="App name filter" hint="Substring to filter RUM applications (leave blank to include all)">
                <input style={inputStyle} value={draft.appNameFilter} onChange={(e) => set("appNameFilter", e.target.value)} placeholder="e.g. VyStar" />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Login action pattern" hint="Substring match for login step">
                  <input style={inputStyle} value={draft.loginActionPattern} onChange={(e) => set("loginActionPattern", e.target.value)} placeholder="login" />
                </Field>
                <Field label="Balance action pattern" hint="Substring match for balance step">
                  <input style={inputStyle} value={draft.balanceActionPattern} onChange={(e) => set("balanceActionPattern", e.target.value)} placeholder="balance" />
                </Field>
                <Field label="Transfer action pattern" hint="Substring match for transfer step">
                  <input style={inputStyle} value={draft.transferActionPattern} onChange={(e) => set("transferActionPattern", e.target.value)} placeholder="transfer" />
                </Field>
                <Field label="Confirm action pattern" hint="Substring match for confirm/complete step">
                  <input style={inputStyle} value={draft.confirmActionPattern} onChange={(e) => set("confirmActionPattern", e.target.value)} placeholder="confirm" />
                </Field>
              </div>
            </div>
          </div>

          {/* ── Services ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#526cff", marginBottom: 12 }}>
              Services
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="Service name filter" hint="Substring to filter the service availability table (leave blank for top services by traffic)">
                <input style={inputStyle} value={draft.serviceNameFilter} onChange={(e) => set("serviceNameFilter", e.target.value)} placeholder="e.g. banking" />
              </Field>
              <Field label="SLA target (%)" hint="Used for error budget and SLA compliance calculations">
                <input style={inputStyle} type="number" value={draft.serviceSlaTargetPct} onChange={(e) => set("serviceSlaTargetPct", Number(e.target.value))} step="0.01" min="90" max="100" />
              </Field>
            </div>
          </div>

          {/* ── Financial Parameters ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#526cff", marginBottom: 12 }}>
              Financial Parameters (for modeled metrics)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Avg transaction value ($)" hint="Used to model revenue at risk">
                <input style={inputStyle} type="number" value={draft.avgTransactionValueUSD} onChange={(e) => set("avgTransactionValueUSD", Number(e.target.value))} min="0" />
              </Field>
              <Field label="Monthly cloud budget ($K)" hint="Used for cloud spend MTD tile">
                <input style={inputStyle} type="number" value={draft.monthlyCloudBudgetK} onChange={(e) => set("monthlyCloudBudgetK", Number(e.target.value))} min="0" />
              </Field>
              <Field label="Monthly infra cost ($K)" hint="Used to calculate cost per transaction">
                <input style={inputStyle} type="number" value={draft.monthlyInfraCostK} onChange={(e) => set("monthlyInfraCostK", Number(e.target.value))} min="0" />
              </Field>
            </div>
          </div>
        </div>

        <div style={{ padding: "14px 24px", borderTop: "1px solid #3a3f52", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="default" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="accent" onClick={handleSave}>Save &amp; Apply</Button>
        </div>
      </div>
    </>
  );
};
