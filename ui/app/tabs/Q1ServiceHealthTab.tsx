import React, { useMemo, useCallback } from "react";
import { useDqlQuery } from "../hooks/useDqlQuery";
import { useSettings } from "../SettingsContext";
import { KpiCard, Sparkline, Section, TabPage, GridRow } from "../components/KpiCard";
import type { KpiStatus } from "../components/KpiCard";
import { useAIAssist, analyzeServiceHealth } from "../components/AIAssist";
import { useDTIntelligence, buildDTPromptQ1 } from "../components/DynatraceIntelligence";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tc(timeframe: string): string {
  if (timeframe === "MTD") return "from: now()@M";
  return `from: now()-${timeframe}`;
}

function availStatus(pct: number): KpiStatus {
  if (pct >= 99.9) return "good";
  if (pct >= 99.0) return "warning";
  return "critical";
}

function fmtPct(n: number): string {
  return (Math.round(n * 1000) / 1000).toFixed(2) + "%";
}

function fmtMs(us: number): string {
  const ms = us / 1000;
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return ms.toFixed(0) + "ms";
}

// ── Service Availability Row ─────────────────────────────────────────────────
interface SvcRow {
  name: string;
  avail: number;
  errorRate: number;
  requests: number;
}

const ServiceAvailRow: React.FC<{ row: SvcRow; target: number }> = ({ row, target }) => {
  const status = availStatus(row.avail);
  const dot = status === "good" ? "#00D26A" : status === "warning" ? "#FCD53F" : "#F8312F";
  const barW = Math.min((row.avail / 100) * 100, 100);
  const targetX = Math.min((target / 100) * 100, 100);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "180px 80px 1fr 60px",
      alignItems: "center", gap: 8, padding: "5px 0",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#c8cedf" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, display: "inline-block" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: dot }}>{fmtPct(row.avail)}</div>
      <div style={{ position: "relative", height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "visible" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${barW}%`, background: dot, borderRadius: 4 }} />
        <div style={{ position: "absolute", top: -2, height: 12, width: 2, background: "#fff", opacity: 0.5, left: `${targetX}%` }} />
      </div>
      <div style={{ fontSize: 11, color: "#5c6480" }}>{target.toFixed(1)}%</div>
    </div>
  );
};

// ── E2E Latency Waterfall ────────────────────────────────────────────────────
interface LatencySegment {
  name: string;
  ms: number;
  color: string;
}

const LatencyWaterfall: React.FC<{ segments: LatencySegment[]; total: number; loading: boolean }> = ({
  segments, total, loading,
}) => {
  if (loading) return <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>;
  if (segments.length === 0 || total === 0) return <div style={{ color: "#5c6480", fontSize: 12 }}>No trace data in timeframe</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Segment bar */}
      <div style={{ display: "flex", height: 24, borderRadius: 4, overflow: "hidden", gap: 1 }}>
        {segments.map((seg) => (
          <div key={seg.name} style={{ flex: seg.ms, background: seg.color, minWidth: 2 }} title={`${seg.name}: ${seg.ms.toFixed(0)}ms`} />
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        {segments.map((seg) => (
          <div key={seg.name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ color: "#8b92a8" }}>{seg.name}</span>
            <span style={{ color: seg.color, fontWeight: 600 }}>{seg.ms.toFixed(0)}ms</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#8b92a8", marginTop: 2 }}>
        Total <strong style={{ color: "#e8eaf0" }}>{total.toFixed(0)}ms</strong>
        {" — "} top service contributing{" "}
        <strong style={{ color: "#F8312F" }}>
          {segments.length > 0 ? Math.round((segments[segments.length - 1].ms / total) * 100) : 0}%
        </strong>
      </div>
    </div>
  );
};

// ── Third-party Dep Row ──────────────────────────────────────────────────────
interface DepRow {
  name: string;
  avgRtMs: number;
  errorRate: number;
  requests: number;
}

function depStatus(er: number, rt: number): KpiStatus {
  if (er > 2 || rt > 3000) return "critical";
  if (er > 0.5 || rt > 1500) return "warning";
  return "good";
}

const DepRow: React.FC<{ row: DepRow }> = ({ row }) => {
  const st = depStatus(row.errorRate, row.avgRtMs);
  const dot = st === "good" ? "#00D26A" : st === "warning" ? "#FCD53F" : "#F8312F";
  const label = st === "good" ? "Healthy" : st === "warning" ? "Watching" : "SEV-1";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 100px 80px",
      alignItems: "center", gap: 8, padding: "5px 0",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 12, color: "#c8cedf", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
        <span style={{ fontSize: 11, color: "#5c6480" }}>{fmtMs(row.avgRtMs * 1000)} avg · {row.requests.toLocaleString()} req</span>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <span style={{ background: "rgba(255,255,255,0.07)", borderRadius: 4, padding: "2px 6px", fontSize: 10, color: "#8b92a8" }}>
          {row.requests.toLocaleString()} users
        </span>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 600, color: dot,
        border: `1px solid ${dot}`, borderRadius: 4, padding: "2px 8px", textAlign: "center",
      }}>
        {label}
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const Q1ServiceHealthTab: React.FC<{ timeframe: string }> = ({ timeframe }) => {
  const { settings } = useSettings();
  const timeClause = tc(timeframe);

  const svcFilter = settings.serviceNameFilter
    ? `| filter contains(lower(dt.service.name), lower("${settings.serviceNameFilter}"))`
    : "";

  // Service availability
  const svcAvailQ = useDqlQuery(
    `timeseries {
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, by: {dt.service.name}, ${timeClause}
${svcFilter}
| fieldsAdd total_req = arraySum(requests),
  total_fail = arraySum(failures)
| fieldsAdd avail = if(total_req > 0, then: (total_req - total_fail) * 100.0 / total_req, else: 100.0),
  error_rate = if(total_req > 0, then: total_fail * 100.0 / total_req, else: 0.0)
| fields dt.service.name, avail, error_rate, total_req
| sort total_req desc
| limit 8`
  );

  // E2E latency breakdown by service (top 4 services by response time contribution)
  const latencyQ = useDqlQuery(
    `timeseries rt = avg(dt.service.request.response_time), by: {dt.service.name}, ${timeClause}
${svcFilter}
| fieldsAdd avg_rt_us = arrayAvg(rt)
| filter isNotNull(avg_rt_us)
| sort avg_rt_us desc
| limit 4
| fields dt.service.name, avg_rt_us`
  );

  // Overall API error rate with timeseries for sparkline
  const apiErrorQ = useDqlQuery(
    `timeseries {
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, interval: auto, ${timeClause}
| fieldsAdd error_rate = arraySum(failures) * 100.0 / if(arraySum(total) > 0, then: arraySum(total), else: 1.0)`
  );

  // Problems / root-cause signal
  const problemsQ = useDqlQuery(
    `fetch dt.davis.problems, ${timeClause}
| filter status == "OPEN"
| sort startTime desc
| fields title, severityLevel, impactLevel, startTime, affectedEntities
| limit 5`
  );

  // Branch & contact center specific services (high-traffic services that aren't web-facing)
  const branchQ = useDqlQuery(
    `timeseries {
  requests = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count),
  rt = avg(dt.service.request.response_time)
}, by: {dt.service.name}, ${timeClause}
| fieldsAdd total_req = arraySum(requests), total_fail = arraySum(failures), avg_rt_us = arrayAvg(rt)
| fieldsAdd avail = if(total_req > 0, then: (total_req - total_fail) * 100.0 / total_req, else: 100.0),
  error_rate = if(total_req > 0, then: total_fail * 100.0 / total_req, else: 0.0)
| sort total_req desc
| limit 20
| fields dt.service.name, avail, total_req, error_rate, avg_rt_us`
  );

  // ── Derived values ──────────────────────────────────────────────────────────
  const svcRows: SvcRow[] = useMemo(() => (svcAvailQ.records ?? []).map((r) => ({
    name: String(r["dt.service.name"] ?? "Unknown"),
    avail: Number(r.avail ?? 100),
    errorRate: Number(r.error_rate ?? 0),
    requests: Number(r.total_req ?? 0),
  })), [svcAvailQ.records]);

  const latencySegments: LatencySegment[] = useMemo(() => {
    const COLORS = ["#526cff", "#7c9dff", "#00b4e6", "#F8312F"];
    return (latencyQ.records ?? []).map((r, i) => ({
      name: String(r["dt.service.name"] ?? "Service"),
      ms: (Number(r.avg_rt_us ?? 0)) / 1000,
      color: COLORS[i % COLORS.length],
    }));
  }, [latencyQ.records]);

  const latencyTotal = latencySegments.reduce((s, seg) => s + seg.ms, 0);

  const apiErrorRate = useMemo(() => {
    const r = apiErrorQ.records?.[0];
    return Number(r?.error_rate ?? 0);
  }, [apiErrorQ.records]);

  const apiErrorSparkData = useMemo(() => {
    return (apiErrorQ.records ?? []).map((r) => Number(r.error_rate ?? 0));
  }, [apiErrorQ.records]);

  const rootCause = useMemo(() => {
    const r = problemsQ.records?.[0];
    if (!r) return null;
    return {
      title: String(r.title ?? ""),
      severity: String(r.severityLevel ?? ""),
      impact: String(r.impactLevel ?? ""),
    };
  }, [problemsQ.records]);

  const openProblems = (problemsQ.records ?? []).length;

  const depRows: DepRow[] = useMemo(() => (branchQ.records ?? []).slice(4, 9).map((r) => ({
    name: String(r["dt.service.name"] ?? "Unknown"),
    avgRtMs: Number(r.avg_rt_us ?? 0) / 1000,
    errorRate: Number(r.error_rate ?? 0),
    requests: Number(r.total_req ?? 0),
  })), [branchQ.records]);

  const branchRows = useMemo(() => (branchQ.records ?? []).slice(0, 2), [branchQ.records]);

  const slaTarget = settings.serviceSlaTargetPct;

  const { panel: aiPanel } = useAIAssist(useCallback(() =>
    analyzeServiceHealth({ openProblems, apiErrorRate, svcRows, latencyTotalMs: latencyTotal, slaTarget }),
  [openProblems, apiErrorRate, svcRows, latencyTotal, slaTarget]));

  const { panel: dtPanel } = useDTIntelligence(0, useCallback(() =>
    buildDTPromptQ1({ openProblems, apiErrorRate, svcRows, latencyTotalMs: latencyTotal, slaTarget }),
  [openProblems, apiErrorRate, svcRows, latencyTotal, slaTarget]));

  return (
    <TabPage
      question="Which business service is degrading — and what is the true root cause?"
      subtitle="Service health · Integration &amp; dependency trace"
    >
      {aiPanel}
      {dtPanel}
      {/* Row 1: Service availability | E2E Latency | Root Cause */}
      <GridRow columns="5fr 4fr 3fr" gap={12}>
        {/* Business Service Availability */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Business Service Availability vs SLA">
            {svcAvailQ.loading ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
            ) : svcRows.length === 0 ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>No service data. Configure a service name filter in Settings.</div>
            ) : (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "180px 80px 1fr 60px", gap: 8, padding: "4px 0", marginBottom: 2 }}>
                  <div style={{ fontSize: 10, color: "#5c6480", fontWeight: 600, textTransform: "uppercase" }}>Service</div>
                  <div style={{ fontSize: 10, color: "#5c6480", fontWeight: 600, textTransform: "uppercase" }}>Avail</div>
                  <div style={{ fontSize: 10, color: "#5c6480", fontWeight: 600, textTransform: "uppercase" }}>SLA Track</div>
                  <div style={{ fontSize: 10, color: "#5c6480", fontWeight: 600, textTransform: "uppercase" }}>Target</div>
                </div>
                {svcRows.map((row) => (
                  <ServiceAvailRow key={row.name} row={row} target={slaTarget} />
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* E2E Latency Trace */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="End-to-End Latency Trace — Top Services" subtitle="Avg response time contribution">
            <LatencyWaterfall segments={latencySegments} total={latencyTotal} loading={latencyQ.loading} />
          </Section>
        </div>

        {/* Root-Cause Signal */}
        <div style={{
          background: rootCause ? "rgba(252,213,63,0.08)" : "rgba(0,210,106,0.08)",
          border: `1.5px solid ${rootCause ? "#FCD53F" : "#00D26A"}`,
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Root-Cause Signal">
            {problemsQ.loading ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
            ) : rootCause ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#FCD53F" }}>{rootCause.title}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <span style={{ background: "rgba(248,49,47,0.2)", color: "#F8312F", fontSize: 10, fontWeight: 700, borderRadius: 3, padding: "2px 6px" }}>
                    {rootCause.severity}
                  </span>
                  <span style={{ background: "rgba(255,255,255,0.07)", color: "#8b92a8", fontSize: 10, borderRadius: 3, padding: "2px 6px" }}>
                    {rootCause.impact}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#8b92a8", marginTop: 4 }}>
                  {openProblems} open problem{openProblems !== 1 ? "s" : ""}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#00D26A" }}>No active problems</div>
                <div style={{ fontSize: 11, color: "#8b92a8" }}>All services operating within SLA</div>
              </div>
            )}
          </Section>
        </div>
      </GridRow>

      {/* Row 2: Third-party deps | API Error Rate | Branch & Contact */}
      <GridRow columns="5fr 4fr 3fr" gap={12}>
        {/* Third-party dependency health */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Third-Party Dependency Health &amp; Blast Radius" subtitle="Derived from service call metrics">
            {branchQ.loading ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
            ) : depRows.length === 0 ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>No downstream service data</div>
            ) : (
              depRows.map((row) => <DepRow key={row.name} row={row} />)
            )}
          </Section>
        </div>

        {/* Core & Integration API Error Rate */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Core &amp; Integration API Error Rate" subtitle="All monitored services">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 4 }}>
              <div style={{
                fontSize: 36, fontWeight: 700, lineHeight: 1,
                color: apiErrorRate > 2 ? "#F8312F" : apiErrorRate > 0.5 ? "#FCD53F" : "#00D26A",
              }}>
                {apiErrorQ.loading ? "—" : apiErrorRate.toFixed(2) + "%"}
              </div>
              {apiErrorSparkData.length > 1 && (
                <Sparkline
                  data={apiErrorSparkData}
                  color={apiErrorRate > 2 ? "#F8312F" : apiErrorRate > 0.5 ? "#FCD53F" : "#00D26A"}
                  height={36}
                  width={100}
                />
              )}
            </div>
            <div style={{ fontSize: 11, color: "#5c6480", marginTop: 6 }}>
              {svcRows.length > 0 ? svcRows.reduce((s, r) => s + r.requests, 0).toLocaleString() : "—"} calls · {svcRows.length} services monitored
            </div>
          </Section>
        </div>

        {/* Branch & Contact Center Tech */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Branch &amp; Contact Center Tech">
            {branchQ.loading ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
            ) : branchRows.length === 0 ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>No service data</div>
            ) : (
              branchRows.map((r: any, idx: number) => {
                const avail = Number(r.avail ?? 100);
                const color = avail >= 99.9 ? "#00D26A" : avail >= 99.0 ? "#FCD53F" : "#F8312F";
                const platformLabel = idx === 0 ? "TELLER PLATFORM" : "CALL PLATFORM";
                return (
                  <div key={r["dt.service.name"]} style={{
                    marginBottom: 14, paddingBottom: 14,
                    borderBottom: idx === 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#5c6480", marginBottom: 3 }}>
                      {platformLabel}
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{avail.toFixed(2)}%</div>
                    <div style={{ fontSize: 11, color: "#8b92a8", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {String(r["dt.service.name"] ?? "Service")}
                    </div>
                    <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 6 }}>
                      <div style={{ height: "100%", background: color, borderRadius: 2, width: `${Math.min(avail, 100)}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </Section>
        </div>
      </GridRow>
    </TabPage>
  );
};
