import React, { useMemo, useCallback } from "react";
import { useDqlQuery } from "../hooks/useDqlQuery";
import { useSettings } from "../SettingsContext";
import { KpiCard, Sparkline, Section, TabPage, GridRow } from "../components/KpiCard";
import { useAIAssist, analyzeBusinessRisk } from "../components/AIAssist";
import { useDTIntelligence, buildDTPromptQ3 } from "../components/DynatraceIntelligence";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tc(timeframe: string): string {
  if (timeframe === "MTD") return "from: now()@M";
  return `from: now()-${timeframe}`;
}

function fmtPct(n: number, digits = 2): string {
  return n.toFixed(digits) + "%";
}

function fmtMs(us: number): string {
  const ms = us / 1000;
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return ms.toFixed(0) + "ms";
}

function fmtCurrency(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Donut chart (channel mix) ─────────────────────────────────────────────────
interface DonutSlice { label: string; value: number; color: string; }

const DonutChart: React.FC<{ slices: DonutSlice[]; total: number; loading: boolean }> = ({ slices, total, loading }) => {
  if (loading) return <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>;
  if (total === 0 || slices.length === 0) return <div style={{ color: "#5c6480", fontSize: 12 }}>No session data</div>;

  const size = 100; const r = 36; const cx = 50; const cy = 50;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={18} />
        {slices.map((slice) => {
          const dashLen = (slice.value / total) * circumference;
          const el = (
            <circle
              key={slice.label}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={slice.color}
              strokeWidth={18}
              strokeDasharray={`${dashLen} ${circumference - dashLen}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += dashLen;
          return el;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#e8eaf0" fontSize={14} fontWeight={700}>
          {Math.round((slices[0]?.value ?? 0) * 100 / total)}%
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#8b92a8" fontSize={9}>
          {slices[0]?.label}
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {slices.map((sl) => (
          <div key={sl.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: sl.color, flexShrink: 0 }} />
            <span style={{ color: "#c8cedf" }}>{sl.label}</span>
            <span style={{ color: sl.color, fontWeight: 600, marginLeft: "auto" }}>
              {Math.round(sl.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── P95/P99 Latency Table ────────────────────────────────────────────────────
interface LatencyRow { name: string; p95ms: number; p99ms: number; }

const LatencyTable: React.FC<{ rows: LatencyRow[]; loading: boolean }> = ({ rows, loading }) => {
  if (loading) return <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>;
  if (rows.length === 0) return <div style={{ color: "#5c6480", fontSize: 12 }}>No latency data</div>;

  const maxMs = Math.max(...rows.map((r) => r.p99ms), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => (
        <div key={row.name} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#c8cedf" }}>{row.name}</span>
            <span style={{ color: "#8b92a8" }}>
              p95 <strong style={{ color: "#7c9dff" }}>{fmtMs(row.p95ms * 1000)}</strong>
              {" "}p99 <strong style={{ color: "#526cff" }}>{fmtMs(row.p99ms * 1000)}</strong>
            </span>
          </div>
          <div style={{ position: "relative", height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(row.p99ms / maxMs) * 100}%`, background: "#526cff", borderRadius: 3, opacity: 0.5 }} />
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(row.p95ms / maxMs) * 100}%`, background: "#7c9dff", borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const Q3BusinessRiskTab: React.FC<{ timeframe: string }> = ({ timeframe }) => {
  const { settings } = useSettings();
  const timeClause = tc(timeframe);

  const svcFilter = settings.serviceNameFilter
    ? `| filter contains(lower(dt.service.name), lower("${settings.serviceNameFilter}"))`
    : "";

  // Overall service error rate (for revenue at risk calculation)
  const errorRateQ = useDqlQuery(
    `timeseries {
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, ${timeClause}
${svcFilter}
| fieldsAdd total_req = arraySum(total), total_fail = arraySum(failures)
| fieldsAdd error_rate = if(total_req > 0, then: total_fail * 100.0 / total_req, else: 0.0),
  req_per_hour = total_req / (toLong(now() - now() + 1h) / toLong(1h))`
  );

  // SLA compliance MTD
  const slaMtdQ = useDqlQuery(
    `timeseries {
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, from: now()@M
${svcFilter}
| fieldsAdd total_req = arraySum(total), total_fail = arraySum(failures)
| fieldsAdd availability = if(total_req > 0, then: (total_req - total_fail) * 100.0 / total_req, else: 100.0)`
  );

  // Error rates by service (top 3 by traffic)
  const svcErrorQ = useDqlQuery(
    `timeseries {
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, by: {dt.service.name}, ${timeClause}
${svcFilter}
| fieldsAdd total_req = arraySum(total), total_fail = arraySum(failures)
| fieldsAdd error_rate_per_1k = if(total_req > 0, then: total_fail * 1000.0 / total_req, else: 0.0)
| sort total_req desc
| limit 3
| fields dt.service.name, error_rate_per_1k, total_req`
  );

  // P95/P99 latency by service
  const latencyQ = useDqlQuery(
    `timeseries {
  p95 = percentile(dt.service.request.response_time, 95),
  p99 = percentile(dt.service.request.response_time, 99)
}, by: {dt.service.name}, ${timeClause}
${svcFilter}
| fieldsAdd p95_ms = arrayAvg(p95) / 1000.0,
  p99_ms = arrayAvg(p99) / 1000.0
| sort p99_ms desc
| limit 4
| fields dt.service.name, p95_ms, p99_ms`
  );

  // Channel mix — login sessions by device type
  const channelMixQ = useDqlQuery(
    `fetch user.sessions, ${timeClause}
| summarize count(), by: {device.type}
| sort \`count()\` desc`
  );

  // Total transactions for error budget
  const totalTransactionsQ = useDqlQuery(
    `timeseries total = sum(dt.service.request.count), from: now()@M
${svcFilter}
| fieldsAdd total_req = arraySum(total)`
  );

  // Money in Motion — financial transaction bizevents today
  const moneyInMotionQ = useDqlQuery(
    `fetch bizevents, from: now()@d
| filter contains(lower(toString(event.type)), "deposit") or contains(lower(toString(event.type)), "withdraw") or contains(lower(toString(event.type)), "transfer") or contains(lower(toString(event.type)), "payment") or contains(lower(toString(event.type)), "booking") or contains(lower(toString(event.type)), "transaction")
| summarize total = count(),
            deposits = countIf(contains(lower(toString(event.type)), "deposit") or contains(lower(toString(event.type)), "credit")),
            withdrawals = countIf(contains(lower(toString(event.type)), "withdraw") or contains(lower(toString(event.type)), "debit")),
            transfers = countIf(contains(lower(toString(event.type)), "transfer") or contains(lower(toString(event.type)), "payment") or contains(lower(toString(event.type)), "booking"))`
  );

  // ── Derived values ──────────────────────────────────────────────────────────

  const errorRate = Number(errorRateQ.records?.[0]?.error_rate ?? 0);
  const totalReq = Number(errorRateQ.records?.[0]?.total_req ?? 0);
  const reqPerHour = totalReq / Math.max(1, (timeframe === "MTD" ? 720 : parseInt(timeframe) || 1));
  const revenueAtRiskPerHr = (errorRate / 100) * reqPerHour * settings.avgTransactionValueUSD;

  const slaAvailability = Number(slaMtdQ.records?.[0]?.availability ?? 100);
  const slaTarget = settings.serviceSlaTargetPct;
  const slaStatus = slaAvailability >= slaTarget ? "good" as const : slaAvailability >= slaTarget - 0.5 ? "warning" as const : "critical" as const;

  const errorBudgetTarget = 100 - slaTarget;
  const actualErrorRate = 100 - slaAvailability;
  const budgetUsed = errorBudgetTarget > 0 ? Math.min((actualErrorRate / errorBudgetTarget) * 100, 100) : 100;
  const budgetRemaining = Math.max(0, 100 - budgetUsed);
  const budgetStatus = budgetRemaining >= 50 ? "good" as const : budgetRemaining >= 20 ? "warning" as const : "critical" as const;

  const svcErrorRows = useMemo(() => (svcErrorQ.records ?? []).map((r) => ({
    name: String(r["dt.service.name"] ?? "Service"),
    errorPer1k: Number(r.error_rate_per_1k ?? 0),
    totalReq: Number(r.total_req ?? 0),
  })), [svcErrorQ.records]);

  const blendedErrorPer1k = useMemo(() => {
    if (svcErrorRows.length === 0) return 0;
    const totalRequests = svcErrorRows.reduce((s, r) => s + r.totalReq, 0);
    if (totalRequests === 0) return 0;
    return svcErrorRows.reduce((s, r) => s + r.errorPer1k * r.totalReq, 0) / totalRequests;
  }, [svcErrorRows]);

  const latencyRows: LatencyRow[] = useMemo(() => (latencyQ.records ?? []).map((r) => ({
    name: String(r["dt.service.name"] ?? "Service"),
    p95ms: Number(r.p95_ms ?? 0),
    p99ms: Number(r.p99_ms ?? 0),
  })), [latencyQ.records]);

  const channelSlices = useMemo(() => {
    const COLORS: Record<string, string> = {
      mobile: "#526cff", desktop: "#00b4e6", browser: "#00b4e6", tablet: "#FCD53F",
    };
    const LABELS: Record<string, string> = {
      mobile: "Mobile", desktop: "Online", browser: "Online", tablet: "Tablet",
    };
    const merged: Record<string, { label: string; value: number; color: string }> = {};
    for (const r of channelMixQ.records ?? []) {
      const key = String(r["device.type"] ?? "").toLowerCase();
      if (key === "robot" || key === "synthetic" || key === "synthetics") continue;
      const label = LABELS[key] ?? key;
      const color = COLORS[key] ?? "#8b92a8";
      if (!merged[label]) merged[label] = { label, value: 0, color };
      merged[label].value += Number(r["count()"] ?? 0);
    }
    return Object.values(merged).sort((a, b) => b.value - a.value);
  }, [channelMixQ.records]);

  const channelTotal = channelSlices.reduce((s, sl) => s + sl.value, 0);

  // Money in Motion computed values
  const bizTotal = Number(moneyInMotionQ.records?.[0]?.total ?? 0);
  const bizDeposits = Number(moneyInMotionQ.records?.[0]?.deposits ?? 0);
  const bizWithdrawals = Number(moneyInMotionQ.records?.[0]?.withdrawals ?? 0);
  const bizTransfers = Number(moneyInMotionQ.records?.[0]?.transfers ?? 0);
  const avgTx = settings.avgTransactionValueUSD;
  const moneyInMotionTotal = bizTotal > 0 ? bizTotal * avgTx : totalReq * avgTx;
  const hasBizBreakdown = bizTotal > 0;

  const { panel: aiPanel } = useAIAssist(useCallback(() =>
    analyzeBusinessRisk({ errorRate, revenueAtRiskPerHr, slaAvailability, slaTarget, budgetRemaining, blendedErrorPer1k, moneyInMotionTotal, avgTxValue: avgTx }),
  [errorRate, revenueAtRiskPerHr, slaAvailability, slaTarget, budgetRemaining, blendedErrorPer1k, moneyInMotionTotal, avgTx]));

  const { panel: dtPanel } = useDTIntelligence(2, useCallback(() =>
    buildDTPromptQ3({ errorRate, revenueAtRiskPerHr, slaAvailability, slaTarget, budgetRemaining, blendedErrorPer1k, moneyInMotionTotal, avgTxValue: avgTx }),
  [errorRate, revenueAtRiskPerHr, slaAvailability, slaTarget, budgetRemaining, blendedErrorPer1k, moneyInMotionTotal, avgTx]));

  return (
    <TabPage
      question="How many members — and how much business — is at risk?"
      subtitle="Exposure &amp; SLA burn · today"
    >
      {aiPanel}
      {dtPanel}
      {/* Row 1: 4 KPI tiles */}
      <GridRow columns="1fr 1fr 1fr 1fr" gap={12}>
        <KpiCard
          title="Revenue at Risk — Now"
          value={errorRateQ.loading ? "—" : revenueAtRiskPerHr === 0 ? "$0" : fmtCurrency(revenueAtRiskPerHr)}
          subtitle={revenueAtRiskPerHr === 0 ? "No active degradation" : `${fmtCurrency(revenueAtRiskPerHr)}/hr exposure model`}
          status={revenueAtRiskPerHr === 0 ? "good" : revenueAtRiskPerHr < 10000 ? "warning" : "critical"}
          loading={errorRateQ.loading}
          footer={`Modeled: ${fmtCurrency(settings.avgTransactionValueUSD)} avg tx × error rate × req/hr`}
        />
        <KpiCard
          title="SLA Compliance — MTD"
          value={slaMtdQ.loading ? "—" : fmtPct(slaAvailability)}
          subtitle={`${slaAvailability >= slaTarget ? "▲" : "▼"} ${Math.abs(slaAvailability - slaTarget).toFixed(3)} pt ${slaAvailability >= slaTarget ? "above" : "below"} target`}
          status={slaStatus}
          loading={slaMtdQ.loading}
          trend={`Target: ${slaTarget}%`}
        />
        <KpiCard
          title="Error Budget Remaining"
          value={slaMtdQ.loading ? "—" : Math.round(budgetRemaining) + "%"}
          subtitle={`${totalTransactionsQ.records?.[0]?.total_req ? Math.round(Number(totalTransactionsQ.records[0].total_req) / 43200).toFixed(0) + " of 43.2 min monthly budget consumed" : "Month-to-date"}`}
          status={budgetStatus}
          loading={slaMtdQ.loading}
        >
          {!slaMtdQ.loading && (
            <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, marginTop: 4 }}>
              <div style={{
                height: "100%",
                width: `${budgetUsed}%`,
                background: budgetStatus === "good" ? "#00D26A" : budgetStatus === "warning" ? "#FCD53F" : "#F8312F",
                borderRadius: 3,
              }} />
            </div>
          )}
        </KpiCard>
        <KpiCard
          title="Money in Motion — Today"
          value={(moneyInMotionQ.loading || errorRateQ.loading) ? "—" : fmtCurrency(moneyInMotionTotal)}
          subtitle={
            hasBizBreakdown
              ? `Deposits ${fmtCurrency(bizDeposits * avgTx)} · Withdrawals ${fmtCurrency(bizWithdrawals * avgTx)} · Transfers ${fmtCurrency(bizTransfers * avgTx)}`
              : `Est. from ${totalReq >= 1_000_000 ? `${(totalReq / 1_000_000).toFixed(1)}M` : `${(totalReq / 1000).toFixed(0)}K`} requests × avg tx value`
          }
          status="neutral"
          loading={moneyInMotionQ.loading || errorRateQ.loading}
        />
      </GridRow>

      {/* Row 2: Error rates | P95/P99 latency | Channel mix */}
      <GridRow columns="1fr 1fr 1fr" gap={12}>
        {/* Error rate per 1000 by service */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Error Rate per 1,000 Transactions" subtitle="Top services by traffic">
            {svcErrorQ.loading ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
            ) : svcErrorRows.length === 0 ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>No service data</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {svcErrorRows.map((row) => (
                  <div key={row.name} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, color: "#c8cedf", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
                        {row.name}
                      </span>
                      <span style={{
                        fontSize: 14, fontWeight: 700,
                        color: row.errorPer1k < 1 ? "#00D26A" : row.errorPer1k < 3 ? "#FCD53F" : "#F8312F",
                      }}>
                        {row.errorPer1k.toFixed(1)}
                      </span>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: "#8b92a8", marginTop: 4, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  Blended error rate <strong style={{ color: "#c8cedf" }}>{blendedErrorPer1k.toFixed(1)}</strong>/1,000 · within {blendedErrorPer1k <= 3 ? "3.0" : "tolerance"} tolerance
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Digital Transaction Latency P95/P99 */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Digital Transaction Latency — P95 / P99" subtitle="By service, sorted by p99 desc">
            <LatencyTable rows={latencyRows} loading={latencyQ.loading} />
          </Section>
        </div>

        {/* Channel Mix */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Channel Mix — Sessions" subtitle="By device type">
            <DonutChart slices={channelSlices} total={channelTotal} loading={channelMixQ.loading} />
            {!channelMixQ.loading && channelTotal > 0 && (
              <div style={{ fontSize: 11, color: "#5c6480", marginTop: 8 }}>
                Total: {channelTotal.toLocaleString()} sessions
              </div>
            )}
          </Section>
        </div>
      </GridRow>
    </TabPage>
  );
};
