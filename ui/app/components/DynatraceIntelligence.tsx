import React, { useState, useEffect, useRef } from "react";
import { publicClient as davisCopilotClient } from "@dynatrace-sdk/client-davis-copilot";
import { AIAssistPanel, ensureStyles } from "./AIAssist";
import type { AIAssistData } from "./AIAssist";

// ── Spinner CSS (injected once) ───────────────────────────────────────────────
const DT_STYLE_ID = "cio-dt-intelligence-styles";
function ensureDTStyles() {
  if (typeof document === "undefined" || document.getElementById(DT_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = DT_STYLE_ID;
  s.textContent = `
@keyframes cio-dt-spin { to { transform: rotate(360deg); } }
.cio-dt-spinner {
  width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid rgba(192,132,252,0.2);
  border-top-color: #c084fc;
  animation: cio-dt-spin 0.75s linear infinite;
}
`;
  document.head.appendChild(s);
}

// ── Context ───────────────────────────────────────────────────────────────────
export const DTIntelligenceContext = React.createContext<{ open: boolean; close: () => void; activeTab: number }>({
  open: false,
  close: () => {},
  activeTab: 0,
});

// ── Loading / Error panels ────────────────────────────────────────────────────
function DTLoadingPanel({ onClose }: { onClose: () => void }) {
  ensureDTStyles();
  return (
    <div className="cio-ai-panel">
      <div className="cio-ai-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L13.5 10.5L22 12L13.5 13.5L12 22L10.5 13.5L2 12L10.5 10.5Z" fill="#c084fc" />
        </svg>
        <span className="cio-ai-title">Dynatrace Intelligence</span>
        <button className="cio-ai-close" onClick={onClose}>✕</button>
      </div>
      <div className="cio-ai-body">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
          <div className="cio-dt-spinner" />
          <span style={{ fontSize: 13, color: "#8b92a8" }}>Analyzing with Davis CoPilot…</span>
        </div>
      </div>
    </div>
  );
}

function DTErrorPanel({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="cio-ai-panel">
      <div className="cio-ai-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L13.5 10.5L22 12L13.5 13.5L12 22L10.5 13.5L2 12L10.5 10.5Z" fill="#c084fc" />
        </svg>
        <span className="cio-ai-title">Dynatrace Intelligence</span>
        <button className="cio-ai-close" onClick={onClose}>✕</button>
      </div>
      <div className="cio-ai-body">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 10px", borderRadius: 6, background: "rgba(248,49,47,0.06)", borderLeft: "3px solid #F8312F" }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <span style={{ fontSize: 13, color: "#c8cedf" }}>{message}</span>
        </div>
      </div>
    </div>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useDTIntelligence(tabIndex: number, buildPrompt: () => { text: string; contextData: string }): { panel: React.ReactNode } {
  const { open, close, activeTab } = React.useContext(DTIntelligenceContext);
  const [analysis, setAnalysis] = useState<AIAssistData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);
  const buildPromptRef = useRef(buildPrompt);
  useEffect(() => { buildPromptRef.current = buildPrompt; });

  useEffect(() => {
    if (!open || activeTab !== tabIndex) {
      fetchedRef.current = false;
      setAnalysis(null);
      setError(null);
      return;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const { text, contextData } = buildPromptRef.current();
    setLoading(true);

    davisCopilotClient.recommenderConversation({
      body: {
        text,
        ...(contextData ? { context: [{ type: "supplementary" as const, value: contextData }] } : {}),
        annotations: { "origin-app": "my.cio.overview" },
      },
    }).then((response) => {
      if (Array.isArray(response)) {
        setError("Unexpected streaming response from Davis CoPilot.");
        setLoading(false);
        return;
      }
      try {
        // Strip any accidental markdown fences before parsing
        const cleaned = response.text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
        const parsed = JSON.parse(cleaned) as AIAssistData;
        setAnalysis(parsed);
      } catch {
        // Fallback: show raw text as the summary
        setAnalysis({ summary: response.text, insights: [], recommendations: [] });
      }
      setLoading(false);
    }).catch((err: unknown) => {
      setError(
        err instanceof Error
          ? err.message
          : "Dynatrace Intelligence is unavailable. Verify the Davis CoPilot scope is granted."
      );
      setLoading(false);
    });
  }, [open, activeTab]);

  if (!open) return { panel: null };

  return {
    panel: (
      <div style={{ padding: "12px 20px 0" }}>
        {loading ? (
          <DTLoadingPanel onClose={close} />
        ) : error ? (
          <DTErrorPanel message={error} onClose={close} />
        ) : analysis ? (
          <AIAssistPanel data={analysis} onClose={close} title="Dynatrace Intelligence" />
        ) : null}
      </div>
    ),
  };
}

// ── Button ────────────────────────────────────────────────────────────────────
export function DTIntelligenceButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  ensureStyles();
  return (
    <button
      className={`cio-ai-assist-btn${open ? " active" : ""}`}
      onClick={onToggle}
      title="Dynatrace Intelligence — generative analysis via Davis CoPilot"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path d="M14 4L15.2 9.6L20 12L15.2 14.4L14 20L12.8 14.4L8 12L12.8 9.6Z" fill="url(#cio-dt-btn-g)" />
        <path d="M7 2L7.7 4.8L10 6L7.7 7.2L7 10L6.3 7.2L4 6L6.3 4.8Z" fill="url(#cio-dt-btn-g)" />
        <path d="M5 13L5.5 14.8L7 16L5.5 17.2L5 19L4.5 17.2L3 16L4.5 14.8Z" fill="url(#cio-dt-btn-g)" />
        <defs>
          <linearGradient id="cio-dt-btn-g" x1="3" y1="2" x2="20" y2="20">
            <stop stopColor="#c084fc" /><stop offset="1" stopColor="#818cf8" />
          </linearGradient>
        </defs>
      </svg>
      Dynatrace Intelligence
    </button>
  );
}

// ── Per-tab prompt builders ───────────────────────────────────────────────────
// Davis CoPilot analyzes data you provide — pass metrics as supplementary context
// and frame the question around Dynatrace observability concepts.

export function buildDTPromptQ1(params: {
  openProblems: number; apiErrorRate: number;
  svcRows: Array<{ name: string; avail: number; errorRate: number }>;
  latencyTotalMs: number; slaTarget: number;
}): { text: string; contextData: string } {
  const { openProblems, apiErrorRate, svcRows, latencyTotalMs, slaTarget } = params;
  const avgAvail = svcRows.length > 0 ? svcRows.reduce((s, r) => s + r.avail, 0) / svcRows.length : 100;
  const belowSla = svcRows.filter(r => r.avail < slaTarget);
  return {
    text: "Analyze this VyStar Credit Union service health data from Dynatrace monitoring. Identify open Davis problems, error rate risks, SLA compliance status, and provide prioritized recommendations.",
    contextData: `VyStar Credit Union — Dynatrace Service Health
Open Davis problems: ${openProblems}
API error rate: ${apiErrorRate.toFixed(2)}%
Services monitored: ${svcRows.length}
Average availability: ${avgAvail.toFixed(3)}%
SLA target: ${slaTarget}%
Services below SLA: ${belowSla.length}${belowSla.length > 0 ? " — " + belowSla.map(s => s.name).join(", ") : ""}
End-to-end latency: ${latencyTotalMs.toFixed(0)}ms
Top services:
${svcRows.slice(0, 5).map(r => `  ${r.name}: ${r.avail.toFixed(2)}% availability, ${r.errorRate.toFixed(2)}% error rate`).join("\n")}`,
  };
}

export function buildDTPromptQ2(params: {
  membersOnline: number; membersImpacted: number; activeIncidents: number;
  loginSuccessRate: number | null; crashFree: number; abandonment: number | null;
  apdex: number; watchCount: number; journeySuccessPct: number | null;
}): { text: string; contextData: string } {
  const { membersOnline, membersImpacted, activeIncidents, loginSuccessRate, crashFree, abandonment, apdex, watchCount, journeySuccessPct } = params;
  return {
    text: "Analyze this VyStar Credit Union real user monitoring data from Dynatrace. Assess user experience quality, active incidents, session health, and login success rates. Identify what is impacting members right now.",
    contextData: `VyStar Credit Union — Dynatrace Real User Monitoring
Active sessions (15 min): ${membersOnline.toLocaleString()}
Sessions with errors (5 min): ${membersImpacted.toLocaleString()}
Active major incidents: ${activeIncidents}
Login success rate: ${loginSuccessRate !== null ? loginSuccessRate.toFixed(1) + "%" : "no data"}
Mobile crash-free sessions: ${crashFree.toFixed(1)}%
Digital abandonment rate: ${abandonment !== null ? abandonment.toFixed(1) + "%" : "no data"}
Apdex score: ${apdex.toFixed(2)}
E2E journey success: ${journeySuccessPct !== null ? journeySuccessPct.toFixed(1) + "%" : "no data"} (target 99.5%)
Services on watch list (elevated error rate): ${watchCount}`,
  };
}

export function buildDTPromptQ3(params: {
  errorRate: number; revenueAtRiskPerHr: number; slaAvailability: number;
  slaTarget: number; budgetRemaining: number; blendedErrorPer1k: number;
  moneyInMotionTotal: number; avgTxValue: number;
}): { text: string; contextData: string } {
  const { errorRate, revenueAtRiskPerHr, slaAvailability, slaTarget, budgetRemaining, blendedErrorPer1k, moneyInMotionTotal, avgTxValue } = params;
  const slaGap = slaAvailability - slaTarget;
  return {
    text: "Analyze this Dynatrace service reliability data for VyStar Credit Union. Assess SLA compliance, error budget consumption, error rates, and transaction reliability. Identify the top observability risks.",
    contextData: `VyStar Credit Union — Dynatrace Service Reliability
SLA compliance MTD: ${slaAvailability.toFixed(3)}% (${slaGap >= 0 ? "+" : ""}${slaGap.toFixed(3)}% vs ${slaTarget}% target)
Error budget remaining: ${budgetRemaining.toFixed(0)}%
Current service error rate: ${errorRate.toFixed(2)}%
Transaction error exposure: $${revenueAtRiskPerHr.toLocaleString(undefined, { maximumFractionDigits: 0 })}/hr at current error rate
Blended error rate: ${blendedErrorPer1k.toFixed(1)} per 1,000 transactions
Digital transaction volume: ${moneyInMotionTotal > 0 ? "$" + (moneyInMotionTotal / 1_000_000).toFixed(1) + "M" : "not available"}
Average transaction value: $${avgTxValue}`,
  };
}

export function buildDTPromptQ4(params: {
  cfr: number; avgMttrMin: number; totalClosedProblems: number;
  deploysToday: number; rollbacksToday: number; deploys30d: number;
  avgCpu: number; avgMem: number; securityEventCount: number; cloudBurnPct: number | null;
}): { text: string; contextData: string } {
  const { cfr, avgMttrMin, totalClosedProblems, deploysToday, rollbacksToday, deploys30d, avgCpu, avgMem, securityEventCount, cloudBurnPct } = params;
  const mttrDesc = avgMttrMin < 1 ? "<1 min" : avgMttrMin >= 60 ? (avgMttrMin / 60).toFixed(1) + "h" : Math.round(avgMttrMin) + " min";
  return {
    text: "Analyze this Dynatrace deployment and incident data for VyStar Credit Union. Assess change failure rate, MTTR, deployment-correlated problems, and infrastructure stability trends.",
    contextData: `VyStar Credit Union — Dynatrace Change & Incident Data
Change failure rate (30d): ${cfr.toFixed(1)}% (elite target: ≤5%)
Mean time to recovery (MTTR): ${mttrDesc} (target: ≤60 min)
Problems resolved (30d): ${totalClosedProblems}
Deployments today: ${deploysToday}
Rollbacks today: ${rollbacksToday}
Deployments (30d): ${deploys30d}
Average CPU across hosts: ${avgCpu.toFixed(0)}%
Average memory across hosts: ${avgMem.toFixed(0)}%
Runtime security events (critical/high, 24h): ${securityEventCount}
Cloud infrastructure spend vs budget: ${cloudBurnPct !== null ? cloudBurnPct.toFixed(0) + "%" : "not available"}`,
  };
}

export function buildDTPromptQ5(params: {
  wowGrowth: number | null; avgCpu: number; avgMem: number;
  runwayMonths: number | null; deploys30d: number; peakHrLoad: number;
  hostCount: number; curTotal: number; prevTotal: number;
}): { text: string; contextData: string } {
  const { wowGrowth, avgCpu, avgMem, runwayMonths, deploys30d, peakHrLoad, hostCount, curTotal, prevTotal } = params;
  const runwayDesc = runwayMonths === null ? "stable (no upward trend)" : runwayMonths > 24 ? ">24 months" : `${runwayMonths.toFixed(1)} months`;
  return {
    text: "Analyze this Dynatrace infrastructure utilization data for VyStar Credit Union. Assess host CPU and memory saturation, traffic growth trends, and capacity runway. Identify any infrastructure risks.",
    contextData: `VyStar Credit Union — Dynatrace Infrastructure Capacity
Monitored hosts: ${hostCount}
Average CPU utilization: ${avgCpu.toFixed(0)}%
Average memory utilization: ${avgMem.toFixed(0)}%
Capacity runway at current growth rate: ${runwayDesc}
Week-over-week traffic growth: ${wowGrowth !== null ? (wowGrowth >= 0 ? "+" : "") + wowGrowth.toFixed(1) + "%" : "not available"}
Requests this week vs last week: ${curTotal.toLocaleString()} vs ${prevTotal.toLocaleString()}
Peak hourly load: ${peakHrLoad.toLocaleString()} events/hour
Deployments (30d): ${deploys30d}`,
  };
}

export function buildDTPromptQ6(params: {
  complianceScore: number; criticalVulns: number; highVulns: number; mediumVulns: number;
  authIsAnomaly: boolean; authFailNow: number; authFailBaseline: number;
  authAnomalyMultiple: number | null; passingCount: number; deploys30d: number;
  openProblems: number; criticalProblems: number; slaOk: boolean;
  slaAvailability: number; slaTarget: number;
}): { text: string; contextData: string } {
  const { complianceScore, criticalVulns, highVulns, mediumVulns, authIsAnomaly, authFailNow, authFailBaseline, authAnomalyMultiple, passingCount, deploys30d, openProblems, criticalProblems, slaOk, slaAvailability, slaTarget } = params;
  return {
    text: "Analyze this Dynatrace security and runtime protection data for VyStar Credit Union. Assess open vulnerabilities, authentication anomalies, active security events, and infrastructure problem counts.",
    contextData: `VyStar Credit Union — Dynatrace Security & Runtime Protection
Composite security/compliance score: ${complianceScore}/100
Compliance pillars passing: ${passingCount}/5
Runtime security findings (24h): ${criticalVulns} critical, ${highVulns} high, ${mediumVulns} medium
Authentication failure rate (1h): ${authFailNow.toFixed(1)}% (7-day baseline: ${authFailBaseline.toFixed(1)}%)
Authentication anomaly: ${authIsAnomaly ? "YES — " + (authAnomalyMultiple?.toFixed(1) ?? "?") + "× above baseline (possible credential stuffing)" : "No anomaly detected"}
SLA compliance MTD: ${slaAvailability.toFixed(3)}% vs ${slaTarget}% target — ${slaOk ? "PASSING" : "FAILING"}
Open Davis problems: ${openProblems} (${criticalProblems} critical)
Deployments with audit trail (30d): ${deploys30d}`,
  };
}
