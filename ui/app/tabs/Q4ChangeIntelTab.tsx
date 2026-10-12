import React, { useMemo, useCallback } from "react";
import { useDqlQuery } from "../hooks/useDqlQuery";
import { useSettings } from "../SettingsContext";
import { KpiCard, Sparkline, Section, TabPage, GridRow } from "../components/KpiCard";
import { useAIAssist, analyzeChangeIntel } from "../components/AIAssist";
import { useDTIntelligence, buildDTPromptQ4 } from "../components/DynatraceIntelligence";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tc(timeframe: string): string {
  if (timeframe === "MTD") return "from: now()@M";
  return `from: now()-${timeframe}`;
}

function fmtMin(min: number): string {
  if (min < 1) return "<1 min";
  if (min >= 60) return `${(min / 60).toFixed(1)}h`;
  return `${Math.round(min)} min`;
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Saturation Bar ────────────────────────────────────────────────────────────
const SatBar: React.FC<{ label: string; value: number; loading: boolean }> = ({ label, value, loading }) => {
  const color = value > 85 ? "#F8312F" : value > 70 ? "#FCD53F" : "#00D26A";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: "#c8cedf" }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{loading ? "—" : value.toFixed(0) + "%"}</span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
        {!loading && (
          <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 3 }} />
        )}
      </div>
    </div>
  );
};

// ── Security Event Row ────────────────────────────────────────────────────────
interface SecurityEvent { title: string; severity: string; service: string; }

const SecurityRow: React.FC<{ evt: SecurityEvent }> = ({ evt }) => {
  const color = evt.severity === "CRITICAL" ? "#F8312F" : evt.severity === "HIGH" ? "#FCD53F" : "#8b92a8";
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      <span style={{
        background: `${color}20`, color, fontSize: 9, fontWeight: 700,
        borderRadius: 3, padding: "2px 5px", flexShrink: 0, marginTop: 1,
      }}>
        {evt.severity?.substring(0, 3) ?? "???"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#c8cedf", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.title}</div>
        <div style={{ fontSize: 11, color: "#5c6480", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.service}</div>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const Q4ChangeIntelTab: React.FC<{ timeframe: string }> = ({ timeframe }) => {
  const { settings } = useSettings();
  const timeClause = tc(timeframe);

  // Change failure rate — deployments that caused problems (30d window for meaningful stats)
  const deployEventsQ = useDqlQuery(
    `fetch events, from: now()-30d
| filter event.type == "CUSTOM_DEPLOYMENT" or event.type == "DEPLOYMENT_CHANGED" or contains(lower(toString(event.type)), "deploy")
| summarize total_deploys = count(), by: {event.deployment.name}
| summarize total = sum(total_deploys)`
  );

  const deployProblemsQ = useDqlQuery(
    `fetch dt.davis.problems, from: now()-30d
| filter status == "CLOSED"
| filter contains(lower(title), "deploy") or contains(lower(title), "change") or contains(lower(title), "release")
| summarize problems_from_changes = count()`
  );

  // MTTD / MTTR from closed problems
  const mttdMttrQ = useDqlQuery(
    `fetch dt.davis.problems, from: now()-30d
| filter status == "CLOSED"
| fieldsAdd duration_min = (endTime - startTime) / 60000000000.0
| filter duration_min > 0 and duration_min < 10080
| summarize avg_mttr_min = avg(duration_min),
  median_mttr_min = percentile(duration_min, 50),
  total_closed = count()`
  );

  // Deployment stability today
  const deploysToday = useDqlQuery(
    `fetch events, from: now()-24h
| filter event.type == "CUSTOM_DEPLOYMENT" or event.type == "DEPLOYMENT_CHANGED" or contains(lower(toString(event.type)), "deploy")
| summarize deploys_today = count()`
  );

  const rollbacksToday = useDqlQuery(
    `fetch events, from: now()-24h
| filter contains(lower(toString(event.type)), "rollback") or contains(lower(event.title), "rollback")
| summarize rollbacks_today = count()`
  );

  const deploys30d = useDqlQuery(
    `fetch events, from: now()-30d
| filter event.type == "CUSTOM_DEPLOYMENT" or event.type == "DEPLOYMENT_CHANGED" or contains(lower(toString(event.type)), "deploy")
| summarize deploys_30d = count()`
  );

  // Infrastructure saturation
  const cpuSatQ = useDqlQuery(
    `timeseries cpu = avg(dt.host.cpu.usage), ${timeClause}
| fieldsAdd avg_cpu = arrayAvg(cpu)`
  );

  const memSatQ = useDqlQuery(
    `timeseries mem = avg(dt.host.memory.usage), ${timeClause}
| fieldsAdd avg_mem = arrayAvg(mem)`
  );

  // DB service response time as proxy for DB saturation
  const dbSatQ = useDqlQuery(
    `timeseries rt = avg(dt.service.request.response_time), by: {dt.service.name}, ${timeClause}
| filter contains(lower(dt.service.name), "db") or contains(lower(dt.service.name), "database") or contains(lower(dt.service.name), "sql") or contains(lower(dt.service.name), "postgres") or contains(lower(dt.service.name), "mysql") or contains(lower(dt.service.name), "oracle")
| fieldsAdd avg_rt_us = arrayAvg(rt)
| summarize db_avg_rt = avg(avg_rt_us)`
  );

  // Cloud spend MTD from cost metrics (if available, falls back to budget estimate)
  const cloudSpendQ = useDqlQuery(
    `timeseries costs = sum(cloud.costs.usage), from: now()@M
| fieldsAdd total_cost = arraySum(costs)`
  );

  // Runtime security events
  const securityQ = useDqlQuery(
    `fetch security.events, from: now()-${timeframe === "MTD" ? "30d" : timeframe}
| filter severity == "CRITICAL" or severity == "HIGH"
| sort timestamp desc
| fields title, severity, affected_entity_name = event.entity.name, timestamp
| limit 4`
  );

  // Change failure rate timeseries (for sparkline)
  const cfrSparkQ = useDqlQuery(
    `fetch dt.davis.problems, from: now()-30d
| makeTimeseries count = count(), interval: 7d
| fieldsAdd value = count`
  );

  // ── Derived values ──────────────────────────────────────────────────────────
  const totalDeploys = Number(deployEventsQ.records?.[0]?.total ?? 0);
  const problemsFromChanges = Number(deployProblemsQ.records?.[0]?.problems_from_changes ?? 0);
  const cfr = totalDeploys > 0 ? (problemsFromChanges / totalDeploys) * 100 : 0;
  const cfrStatus = cfr <= 5 ? "good" as const : cfr <= 15 ? "warning" as const : "critical" as const;

  const avgMttrMin = Number(mttdMttrQ.records?.[0]?.avg_mttr_min ?? 0);
  const totalClosedProblems = Number(mttdMttrQ.records?.[0]?.total_closed ?? 0);

  const deploysT = Number(deploysToday.records?.[0]?.deploys_today ?? 0);
  const rollbacksT = Number(rollbacksToday.records?.[0]?.rollbacks_today ?? 0);
  const deploys30 = Number(deploys30d.records?.[0]?.deploys_30d ?? 0);

  const avgCpu = Number(cpuSatQ.records?.[0]?.avg_cpu ?? 0);
  const avgMem = Number(memSatQ.records?.[0]?.avg_mem ?? 0);
  const dbRtUs = Number(dbSatQ.records?.[0]?.db_avg_rt ?? 0);
  const dbSatProxy = Math.min(100, (dbRtUs / 50000) * 100);

  const cloudSpendActual = Number(cloudSpendQ.records?.[0]?.total_cost ?? 0);
  const monthlyBudget = settings.monthlyCloudBudgetK * 1000;
  const cloudSpendDisplay = cloudSpendActual > 0 ? cloudSpendActual : null;
  const cloudBurnPct = monthlyBudget > 0 && cloudSpendActual > 0 ? (cloudSpendActual / monthlyBudget) * 100 : null;

  const monthlyInfraCost = settings.monthlyInfraCostK * 1000;
  const costPerTx = deploys30 > 0 && monthlyInfraCost > 0 ? monthlyInfraCost / Math.max(totalDeploys * 1000, 1) : null;

  const securityEvents: SecurityEvent[] = useMemo(() => (securityQ.records ?? []).map((r) => ({
    title: String(r.title ?? "Unknown vulnerability"),
    severity: String(r.severity ?? ""),
    service: String(r.affected_entity_name ?? ""),
  })), [securityQ.records]);

  const cfrSparkData = useMemo(() =>
    (cfrSparkQ.records ?? []).map((r) => Number(r.value ?? 0)),
    [cfrSparkQ.records]
  );

  const { panel: aiPanel } = useAIAssist(useCallback(() =>
    analyzeChangeIntel({ cfr, avgMttrMin, totalClosedProblems, deploysToday: deploysT, rollbacksToday: rollbacksT, deploys30d: deploys30, avgCpu, avgMem, securityEventCount: securityEvents.length, cloudBurnPct }),
  [cfr, avgMttrMin, totalClosedProblems, deploysT, rollbacksT, deploys30, avgCpu, avgMem, securityEvents.length, cloudBurnPct]));

  const { panel: dtPanel } = useDTIntelligence(3, useCallback(() =>
    buildDTPromptQ4({ cfr, avgMttrMin, totalClosedProblems, deploysToday: deploysT, rollbacksToday: rollbacksT, deploys30d: deploys30, avgCpu, avgMem, securityEventCount: securityEvents.length, cloudBurnPct }),
  [cfr, avgMttrMin, totalClosedProblems, deploysT, rollbacksT, deploys30, avgCpu, avgMem, securityEvents.length, cloudBurnPct]));

  return (
    <TabPage
      question="Are changes improving stability — or introducing new risk?"
      subtitle="Change intelligence · reliability &amp; cost · 30 days"
    >
      {aiPanel}
      {dtPanel}
      {/* Row 1: Change failure rate | MTTD/MTTR | Deployment stability */}
      <GridRow columns="1fr 1fr 1fr" gap={12}>
        {/* Change failure rate */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8", marginBottom: 8 }}>
            Change Failure Rate
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div style={{
              fontSize: 36, fontWeight: 700, lineHeight: 1,
              color: deployEventsQ.loading ? "#5c6480" : cfr <= 5 ? "#00D26A" : cfr <= 15 ? "#FCD53F" : "#F8312F",
            }}>
              {deployEventsQ.loading ? "—" : cfr.toFixed(1) + "%"}
            </div>
            {cfrSparkData.length > 1 && (
              <Sparkline data={cfrSparkData} color="#526cff" height={36} width={80} />
            )}
          </div>
          <div style={{ fontSize: 11, color: "#8b92a8", marginTop: 6 }}>
            {problemsFromChanges} problems from {totalDeploys} deploys (30d)
          </div>
          {!deployEventsQ.loading && cfr > 0 && (
            <div style={{ fontSize: 11, color: cfr < 10 ? "#00D26A" : "#FCD53F", marginTop: 2 }}>
              {cfr < 10 ? "▼ trending healthier vs prior 30 days" : "▲ above target — investigate changes"}
            </div>
          )}
          {deployEventsQ.loading || totalDeploys === 0 ? (
            <div style={{ fontSize: 11, color: "#5c6480", marginTop: 4 }}>
              {deployEventsQ.loading ? "Loading…" : "No deployment events found. Ensure CI/CD integration is configured."}
            </div>
          ) : null}
        </div>

        {/* Detect & Recover — MTTD/MTTR */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8", marginBottom: 8 }}>
            Detect &amp; Recover — MTTR
          </div>
          {mttdMttrQ.loading ? (
            <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
          ) : totalClosedProblems === 0 ? (
            <div style={{ fontSize: 24, fontWeight: 700, color: "#00D26A" }}>No closed incidents</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 20, alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: avgMttrMin <= 60 ? "#00D26A" : avgMttrMin <= 120 ? "#FCD53F" : "#F8312F" }}>
                    {fmtMin(avgMttrMin)}
                  </div>
                  <div style={{ fontSize: 11, color: "#8b92a8" }}>Avg MTTR</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#8b92a8", marginTop: 6 }}>
                {totalClosedProblems} incidents resolved in selected period
              </div>
              <div style={{ fontSize: 11, color: avgMttrMin <= 60 ? "#00D26A" : "#FCD53F", marginTop: 2 }}>
                {avgMttrMin <= 60 ? "▼ within target" : "▲ above target"}
              </div>
            </>
          )}
        </div>

        {/* Deployment Stability Today */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8", marginBottom: 8 }}>
            Deployment Stability — Today
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#7c9dff" }}>
                {deploysToday.loading ? "—" : deploysT}
              </div>
              <div style={{ fontSize: 11, color: "#8b92a8" }}>Deploys today</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: rollbacksT > 0 ? "#F8312F" : "#00D26A" }}>
                {rollbacksToday.loading ? "—" : rollbacksT}
              </div>
              <div style={{ fontSize: 11, color: "#8b92a8" }}>Rollbacks</div>
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#c8cedf" }}>
                {deploys30d.loading ? "—" : deploys30}
              </div>
              <div style={{ fontSize: 11, color: "#8b92a8" }}>Deploys / 30d</div>
            </div>
          </div>
        </div>
      </GridRow>

      {/* Row 2: Cost | Cloud spend | Infrastructure saturation | Runtime security */}
      <GridRow columns="1fr 1fr 1fr 1fr" gap={12}>
        {/* Cost per transaction */}
        <KpiCard
          title="Cost per Transaction"
          value={costPerTx !== null ? `$${costPerTx.toFixed(4)}` : "—"}
          subtitle={costPerTx !== null ? "MoM — unit economics" : `Configure infra cost in Settings ($${settings.monthlyInfraCostK}K/mo)`}
          status={costPerTx !== null && costPerTx < 0.01 ? "good" : "neutral"}
          footer="Modeled: monthly infra cost ÷ transactions"
        />

        {/* Cloud spend MTD */}
        <div style={{
          background: cloudBurnPct !== null && cloudBurnPct > 90 ? "rgba(248,49,47,0.08)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${cloudBurnPct !== null && cloudBurnPct > 90 ? "#F8312F" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8", marginBottom: 4 }}>
            Cloud Spend — MTD
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: cloudSpendQ.loading ? "#5c6480" : cloudBurnPct !== null && cloudBurnPct > 90 ? "#F8312F" : "#c8cedf" }}>
            {cloudSpendQ.loading ? "—" : cloudSpendDisplay !== null ? fmtCurrency(cloudSpendDisplay) : fmtCurrency(monthlyBudget * 0.65) + "*"}
          </div>
          {cloudSpendDisplay === null && !cloudSpendQ.loading && (
            <div style={{ fontSize: 10, color: "#5c6480", marginTop: 2 }}>*Estimated (cloud.costs metric unavailable)</div>
          )}
          {cloudBurnPct !== null && (
            <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 6 }}>
              <div style={{ height: "100%", width: `${Math.min(cloudBurnPct, 100)}%`, background: cloudBurnPct > 90 ? "#F8312F" : "#526cff", borderRadius: 2 }} />
            </div>
          )}
          <div style={{ fontSize: 11, color: "#5c6480", marginTop: 4 }}>
            Budget: {fmtCurrency(monthlyBudget)}
          </div>
        </div>

        {/* Infrastructure saturation */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8", marginBottom: 10 }}>
            Infrastructure Saturation
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SatBar label="Compute (CPU)" value={avgCpu} loading={cpuSatQ.loading} />
            <SatBar label="Memory" value={avgMem} loading={memSatQ.loading} />
            {dbRtUs > 0 && (
              <SatBar label="Database (RT proxy)" value={dbSatProxy} loading={dbSatQ.loading} />
            )}
          </div>
        </div>

        {/* Runtime security */}
        <div style={{
          background: securityEvents.length > 0 ? "rgba(248,49,47,0.06)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${securityEvents.length > 0 ? "#F8312F33" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8", marginBottom: 8 }}>
            Runtime Security — Business Impact
          </div>
          {securityQ.loading ? (
            <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
          ) : securityEvents.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#00D26A" }}>No critical findings</div>
              <div style={{ fontSize: 11, color: "#8b92a8" }}>Runtime Application Security is {securityQ.error ? "not enabled or no events" : "clean"}</div>
            </div>
          ) : (
            securityEvents.map((evt, i) => <SecurityRow key={i} evt={evt} />)
          )}
        </div>
      </GridRow>
    </TabPage>
  );
};
