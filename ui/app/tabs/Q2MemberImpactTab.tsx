import React, { useMemo, useState, useEffect, useCallback } from "react";
import { useDqlQuery } from "../hooks/useDqlQuery";
import { useSettings } from "../SettingsContext";
import { Sparkline, Section, TabPage, GridRow } from "../components/KpiCard";
import { useAIAssist, analyzeMemberImpact } from "../components/AIAssist";
import { useDTIntelligence, buildDTPromptQ2 } from "../components/DynatraceIntelligence";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tc(timeframe: string): string {
  if (timeframe === "MTD") return "from: now()@M";
  return `from: now()-${timeframe}`;
}

function fmtPct(n: number, digits = 2): string {
  return n.toFixed(digits) + "%";
}

// ── Live clock ────────────────────────────────────────────────────────────────
function useLiveClock(): string {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ── Journey Step ─────────────────────────────────────────────────────────────
interface StepCardProps {
  label: string;
  successRate: number | null;
  loading: boolean;
  error?: string | null;
  trend?: string;
  attempts?: number | null;
}

const JourneyStep: React.FC<StepCardProps> = ({ label, successRate, loading, error, trend, attempts }) => {
  const good = successRate !== null && successRate >= 99.0;
  const warn = successRate !== null && successRate >= 95.0 && !good;
  const color = loading || successRate === null ? "#5c6480" : good ? "#00D26A" : warn ? "#FCD53F" : "#F8312F";
  const displayVal = error ? "ERR" : loading ? "—" : successRate !== null ? fmtPct(successRate) : "no data";

  return (
    <div style={{
      flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, minWidth: 120,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: error ? "#F8312F" : color }} title={error ?? undefined}>
        {displayVal}
      </div>
      {attempts != null && attempts > 0 && (
        <div style={{ fontSize: 10, color: "#5c6480" }}>{attempts.toLocaleString()} attempts</div>
      )}
      {trend && (
        <div style={{ fontSize: 10, color: "#8b92a8" }}>{trend}</div>
      )}
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 4 }}>
        <div style={{ height: "100%", background: color, borderRadius: 2, width: `${successRate ?? 0}%` }} />
      </div>
    </div>
  );
};

// ── Step arrow with optional drop-off annotation ──────────────────────────────
const StepArrow: React.FC<{ dropOff: number | null }> = ({ dropOff }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, minWidth: 28 }}>
    <div style={{ color: "#3a3f52", fontSize: 18 }}>›</div>
    {dropOff !== null && dropOff > 0.005 && (
      <div style={{ fontSize: 9, color: "#F8312F", whiteSpace: "nowrap" }}>↓ {dropOff.toFixed(2)} pt</div>
    )}
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
export const Q2MemberImpactTab: React.FC<{ timeframe: string }> = ({ timeframe }) => {
  const { settings } = useSettings();
  const timeClause = tc(timeframe);
  const clock = useLiveClock();

  const appFilter = settings.appNameFilter
    ? `| filter contains(lower(frontend.name), lower("${settings.appNameFilter}"))`
    : "";

  // Members online — distinct browser sessions with any event in last 15 min
  const membersOnlineQ = useDqlQuery(
    `fetch user.events, from: now()-15m
| summarize members_online = countDistinct(dt.rum.browser.session_id)`
  );

  // Members impacted — sessions with errors or crashes in last 5 min
  const membersImpactedQ = useDqlQuery(
    `fetch user.sessions, from: now()-5m
| filter error.count > 0 or error.has_crash == true
| summarize members_impacted = count()`
  );

  // Active major incidents (open problems impacting applications)
  const incidentsQ = useDqlQuery(
    `fetch dt.davis.problems, from: now()-2h
| filter status == "OPEN"
| filter impactLevel == "APPLICATION" or impactLevel == "ENVIRONMENT"
| summarize active_incidents = count()`
  );

  // Journey step queries — filter by view.name (SPA page views, confirmed working in notebooks)
  const journeyQ = (pattern: string) => [
    `fetch user.events, ${timeClause}`,
    `| filter isNotNull(view.name)`,
    `| filter contains(lower(view.name), "${pattern.toLowerCase()}")`,
    appFilter ? appFilter : null,
    `| summarize total = count(), errors = countIf(characteristics.has_error == true)`,
    `| fieldsAdd success_rate = if(total > 0, then: (total - errors) * 100.0 / total, else: null)`,
  ].filter(Boolean).join("\n");

  const loginQ    = useDqlQuery(journeyQ(settings.loginActionPattern));
  const balanceQ  = useDqlQuery(journeyQ(settings.balanceActionPattern));
  const transferQ = useDqlQuery(journeyQ(settings.transferActionPattern));
  const confirmQ  = useDqlQuery(journeyQ(settings.confirmActionPattern));

  // E2E journey success — overall frontend action success rate
  const journeySuccessQ = useDqlQuery(
    `timeseries {
  total = sum(dt.frontend.user_action.count),
  errors = sum(dt.frontend.user_action.failure_count)
}, ${timeClause}
| fieldsAdd success_rate = if(arraySum(total) > 0, then: (arraySum(total) - arraySum(errors)) * 100.0 / arraySum(total), else: null)`
  );

  // Apdex — avg action duration per app, then score across apps
  const apdexQ = useDqlQuery(
    `timeseries duration = avg(dt.frontend.user_action.duration), by: {frontend.name}, ${timeClause}
| fieldsAdd avg_ms = arrayAvg(duration)
| summarize satisfied = countIf(avg_ms <= 3000),
  tolerating = countIf(avg_ms > 3000 and avg_ms <= 12000),
  total = count()
| fieldsAdd apdex = if(total > 0, then: (toDouble(satisfied) + toDouble(tolerating) / 2.0) / toDouble(total), else: 0.0)`
  );

  const loginPattern = settings.loginActionPattern.toLowerCase();

  // Login success rate - rolling 5 min
  const loginNowQ = useDqlQuery(
    [
      `fetch user.events, from: now()-15m`,
      `| filter isNotNull(view.name)`,
      `| filter contains(lower(view.name), "${loginPattern}")`,
      appFilter || null,
      `| summarize total = count(), errors = countIf(characteristics.has_error == true)`,
      `| fieldsAdd success_rate = if(total > 0, then: (total - errors) * 100.0 / total, else: null)`,
    ].filter(Boolean).join("\n")
  );

  // Login sparkline — makeTimeseries over the selected timeframe, returns one row with arrays
  const loginSparkQ = useDqlQuery(
    [
      `fetch user.events, ${timeClause}`,
      `| filter isNotNull(view.name)`,
      `| filter contains(lower(view.name), "${loginPattern}")`,
      appFilter || null,
      `| makeTimeseries total = count(), errors = countIf(characteristics.has_error == true), interval: auto`,
    ].filter(Boolean).join("\n")
  );

  // Mobile crash-free sessions
  const crashFreeQ = useDqlQuery(
    `fetch user.sessions, ${timeClause}
| filter device.type == "MOBILE"
| summarize total = count(), crashed = countIf(error.has_crash == true)
| fieldsAdd crash_free = if(total > 0, then: (total - crashed) * 100.0 / total, else: 100.0)`
  );


  // Watch list — services with elevated latency (>2x baseline) not yet causing user errors
  const watchQ = useDqlQuery(
    `fetch dt.davis.problems, from: now()-1h
| filter status == "OPEN"
| filter impactLevel == "SERVICES" or impactLevel == "INFRASTRUCTURE"
| summarize watch_count = count()`
  );

  // ── Derived values ──────────────────────────────────────────────────────────
  const membersOnline = Number(membersOnlineQ.records?.[0]?.members_online ?? 0);
  const membersImpacted = Number(membersImpactedQ.records?.[0]?.members_impacted ?? 0);
  const activeIncidents = Number(incidentsQ.records?.[0]?.active_incidents ?? 0);
  const apdex = Number(apdexQ.records?.[0]?.apdex ?? 0);
  const loginNow = loginNowQ.records?.[0]?.success_rate;
  const loginNowPct = loginNow !== null && loginNow !== undefined ? Number(loginNow) : null;
  const crashFree = Number(crashFreeQ.records?.[0]?.crash_free ?? 0);
  const watchCount = Number(watchQ.records?.[0]?.watch_count ?? 0);
  const journeySuccess = journeySuccessQ.records?.[0]?.success_rate;
  const journeySuccessPct = journeySuccess !== null && journeySuccess !== undefined ? Number(journeySuccess) : null;

  const loginSuccessRate = useMemo(() => {
    const r = loginQ.records?.[0];
    return r?.success_rate !== null && r?.success_rate !== undefined ? Number(r.success_rate) : null;
  }, [loginQ.records]);

  const balanceSuccessRate = useMemo(() => {
    const r = balanceQ.records?.[0];
    return r?.success_rate !== null && r?.success_rate !== undefined ? Number(r.success_rate) : null;
  }, [balanceQ.records]);

  const transferSuccessRate = useMemo(() => {
    const r = transferQ.records?.[0];
    return r?.success_rate !== null && r?.success_rate !== undefined ? Number(r.success_rate) : null;
  }, [transferQ.records]);

  const confirmSuccessRate = useMemo(() => {
    const r = confirmQ.records?.[0];
    return r?.success_rate !== null && r?.success_rate !== undefined ? Number(r.success_rate) : null;
  }, [confirmQ.records]);

  // Abandonment: compound drop-off across the two transaction steps (initiate × confirm)
  // = 100 - (transferSuccessRate × confirmSuccessRate / 100)
  // Represents: % of transfer journeys that didn't result in a successful confirmation
  const abandonment = (transferSuccessRate !== null && confirmSuccessRate !== null)
    ? 100 - (transferSuccessRate * confirmSuccessRate / 100)
    : null;

  // Attempt counts for each journey step
  const loginAttempts = useMemo(() => {
    const r = loginQ.records?.[0];
    return r?.total != null ? Number(r.total) : null;
  }, [loginQ.records]);

  const balanceAttempts = useMemo(() => {
    const r = balanceQ.records?.[0];
    return r?.total != null ? Number(r.total) : null;
  }, [balanceQ.records]);

  const transferAttempts = useMemo(() => {
    const r = transferQ.records?.[0];
    return r?.total != null ? Number(r.total) : null;
  }, [transferQ.records]);

  const confirmAttempts = useMemo(() => {
    const r = confirmQ.records?.[0];
    return r?.total != null ? Number(r.total) : null;
  }, [confirmQ.records]);

  // Drop-off deltas between adjacent journey steps (positive = degradation)
  const loginToBalanceDrop = (loginSuccessRate !== null && balanceSuccessRate !== null) ? loginSuccessRate - balanceSuccessRate : null;
  const balanceToTransferDrop = (balanceSuccessRate !== null && transferSuccessRate !== null) ? balanceSuccessRate - transferSuccessRate : null;
  const transferToConfirmDrop = (transferSuccessRate !== null && confirmSuccessRate !== null) ? transferSuccessRate - confirmSuccessRate : null;

  const loginSparkData = useMemo(() => {
    const r = loginSparkQ.records?.[0];
    if (!r) return [];
    const totals = (r.total as number[]) ?? [];
    const errors = (r.errors as number[]) ?? [];
    return totals.map((t: number, i: number) => {
      const e = errors[i] ?? 0;
      return t > 0 ? (t - e) * 100 / t : 0;
    });
  }, [loginSparkQ.records]);

  const allOperational = activeIncidents === 0 && membersImpacted === 0;

  // E2E target
  const journeyTarget = 99.5;

  const { panel: aiPanel } = useAIAssist(useCallback(() =>
    analyzeMemberImpact({ membersOnline, membersImpacted, activeIncidents, loginSuccessRate, crashFree, abandonment, apdex, watchCount, journeySuccessPct }),
  [membersOnline, membersImpacted, activeIncidents, loginSuccessRate, crashFree, abandonment, apdex, watchCount, journeySuccessPct]));

  const { panel: dtPanel } = useDTIntelligence(1, useCallback(() =>
    buildDTPromptQ2({ membersOnline, membersImpacted, activeIncidents, loginSuccessRate, crashFree, abandonment, apdex, watchCount, journeySuccessPct }),
  [membersOnline, membersImpacted, activeIncidents, loginSuccessRate, crashFree, abandonment, apdex, watchCount, journeySuccessPct]));

  return (
    <div style={{ padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {aiPanel}
      {dtPanel}
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#e8eaf0" }}>Digital Banking Command</div>
          <div style={{ fontSize: 12, color: "#8b92a8" }}>VyStar Credit Union — Technology &amp; Member Experience</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            background: "#00D26A", color: "#0d0f1a", fontSize: 11, fontWeight: 700,
            borderRadius: 4, padding: "3px 10px",
          }}>• PRODUCTION</span>
          <span style={{ fontSize: 12, color: "#8b92a8", fontFamily: "monospace" }}>Live {clock}</span>
          <div style={{ fontSize: 10, color: "#5c6480", fontStyle: "italic" }}>Real-time posture · rolling 15 min</div>
        </div>
      </div>

      {/* Status Banner + Journey Funnel */}
      <GridRow columns="auto 1fr" gap={12}>
        {/* Operational Status Banner */}
        <div style={{
          background: allOperational ? "rgba(0,210,106,0.12)" : "rgba(248,49,47,0.12)",
          border: `2px solid ${allOperational ? "#00D26A" : "#F8312F"}`,
          borderRadius: 8, padding: "16px 20px", minWidth: 260,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: allOperational ? "#00D26A" : "#F8312F" }}>
            {allOperational ? "All systems operational" : "Member impact detected"}
          </div>
          <div style={{ fontSize: 11, color: "#8b92a8" }}>
            {allOperational ? "No member-impacting incidents in progress" : `${membersImpacted.toLocaleString()} sessions affected`}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#e8eaf0" }}>{membersOnlineQ.loading ? "—" : membersOnline.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "#8b92a8" }}>Members active (15 min)</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: membersImpacted > 0 ? "#F8312F" : "#e8eaf0" }}>
                {membersImpactedQ.loading ? "—" : membersImpacted.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: "#8b92a8" }}>Members impacted</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: activeIncidents > 0 ? "#F8312F" : "#e8eaf0" }}>
                {incidentsQ.loading ? "—" : activeIncidents}
              </div>
              <div style={{ fontSize: 11, color: "#8b92a8" }}>Active major incidents</div>
            </div>
          </div>
        </div>

        {/* Member Journey Funnel */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8", marginBottom: 10 }}>
            Member Journey — Login → Balance → Transfer (Live success rate)
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <JourneyStep label="Authenticate" successRate={loginSuccessRate} loading={loginQ.loading} error={loginQ.error} attempts={loginAttempts} />
            <StepArrow dropOff={loginToBalanceDrop} />
            <JourneyStep label="Load balances" successRate={balanceSuccessRate} loading={balanceQ.loading} error={balanceQ.error} attempts={balanceAttempts} />
            <StepArrow dropOff={balanceToTransferDrop} />
            <JourneyStep label="Initiate transfer" successRate={transferSuccessRate} loading={transferQ.loading} error={transferQ.error} attempts={transferAttempts} />
            <StepArrow dropOff={transferToConfirmDrop} />
            <JourneyStep label="Complete &amp; confirm" successRate={confirmSuccessRate} loading={confirmQ.loading} error={confirmQ.error} attempts={confirmAttempts} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 12, color: "#8b92a8" }}>
              End-to-end journey success{" "}
              <strong style={{ color: journeySuccessPct !== null && journeySuccessPct >= journeyTarget ? "#00D26A" : "#F8312F" }}>
                {journeySuccessQ.loading ? "—" : journeySuccessPct !== null ? fmtPct(journeySuccessPct) : "—"}
              </strong>
              {" "}against{" "}
              <span style={{ color: "#8b92a8" }}>{journeyTarget}% target</span>
            </div>
            <div style={{ fontSize: 12, color: "#8b92a8" }}>
              Apdex (digital banking){" "}
              <strong style={{ color: apdex >= 0.94 ? "#00D26A" : apdex >= 0.8 ? "#FCD53F" : "#F8312F" }}>
                {apdexQ.loading ? "—" : apdex.toFixed(2)}
              </strong>
            </div>
          </div>
        </div>
      </GridRow>

      {/* Bottom row: 4 KPI tiles */}
      <GridRow columns="1fr 1fr 1fr 1fr" gap={12}>
        {/* Login Success - Now */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8" }}>Login Success — Now</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 6 }}>
            <div style={{
              fontSize: 32, fontWeight: 700,
              color: loginNowPct === null ? "#00D26A" : loginNowPct >= 99 ? "#00D26A" : loginNowPct >= 95 ? "#FCD53F" : "#F8312F",
            }}>
              {loginNowQ.loading ? "—" : loginNowPct !== null ? fmtPct(loginNowPct) : "100%"}
            </div>
            {loginSparkData.length > 2 && (
              <Sparkline
                data={loginSparkData}
                color={loginNowPct !== null && loginNowPct >= 99 ? "#00D26A" : "#FCD53F"}
                height={32} width={80}
              />
            )}
          </div>
          <div style={{ fontSize: 11, color: "#5c6480", marginTop: 4 }}>
            {loginNowQ.loading ? "" : loginNowPct === null ? "No login events in last 15 min — no failures recorded" : "rolling 15 min"}
          </div>
        </div>

        {/* Mobile Crash-Free Sessions */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8" }}>Mobile Crash-Free Sessions</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 6,
            color: crashFreeQ.loading ? "#5c6480" : crashFree >= 99.5 ? "#00D26A" : crashFree >= 98 ? "#FCD53F" : "#F8312F" }}>
            {crashFreeQ.loading ? "—" : fmtPct(crashFree)}
          </div>
          <div style={{ fontSize: 11, color: "#5c6480", marginTop: 2 }}>Mobile sessions in timeframe</div>
        </div>

        {/* Digital Abandonment Rate */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8" }}>Digital Abandonment Rate</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 6,
            color: (transferQ.loading || confirmQ.loading) || abandonment === null ? "#5c6480" : abandonment <= 10 ? "#00D26A" : abandonment <= 25 ? "#FCD53F" : "#F8312F" }}>
            {(transferQ.loading || confirmQ.loading) ? "—" : abandonment === null ? "No data" : fmtPct(abandonment, 1)}
          </div>
          <div style={{ fontSize: 11, color: "#5c6480", marginTop: 2 }}>
            {abandonment === null ? "—" : abandonment <= 10 ? "▼ healthy" : "▲ elevated"} · transfer → confirm compound drop-off
          </div>
        </div>

        {/* Watch List */}
        <div style={{
          background: watchCount > 0 ? "rgba(252,213,63,0.08)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${watchCount > 0 ? "#FCD53F" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8" }}>Watch List</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 6, color: watchCount > 0 ? "#FCD53F" : "#00D26A" }}>
            {watchQ.loading ? "—" : watchCount}
          </div>
          <div style={{ fontSize: 11, color: "#8b92a8", marginTop: 2 }}>
            {watchCount === 0 ? "No elevated risks" : `${watchCount} service${watchCount !== 1 ? "s" : ""} with elevated risk — not yet member-impacting`}
          </div>
        </div>
      </GridRow>
    </div>
  );
};
