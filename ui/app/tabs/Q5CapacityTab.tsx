import React, { useMemo, useCallback } from "react";
import { useDqlQuery } from "../hooks/useDqlQuery";
import { KpiCard, Sparkline, Section, TabPage, GridRow } from "../components/KpiCard";
import type { KpiStatus } from "../components/KpiCard";
import { useAIAssist, analyzeCapacity } from "../components/AIAssist";
import { useDTIntelligence, buildDTPromptQ5 } from "../components/DynatraceIntelligence";

function fmtPct(n: number, digits = 1): string {
  return n.toFixed(digits) + "%";
}

function fmtReq(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export const Q5CapacityTab: React.FC<{ timeframe: string }> = () => {
  // Traffic this week vs prior week
  const trafficCurrentQ = useDqlQuery(
    `timeseries total = sum(dt.service.request.count), from: now()-7d
| fieldsAdd cur_total = arraySum(total)`
  );
  const trafficPriorQ = useDqlQuery(
    `timeseries total = sum(dt.service.request.count), from: now()-14d, to: now()-7d
| fieldsAdd prev_total = arraySum(total)`
  );

  // Avg CPU and memory across all hosts — last 15 min
  const cpuMemQ = useDqlQuery(
    `timeseries {
  cpu = avg(dt.host.cpu.usage),
  mem = avg(dt.host.memory.usage)
}, from: now()-15m
| fieldsAdd avg_cpu = arrayAvg(cpu), avg_mem = arrayAvg(mem)`
  );

  // 30-day CPU trend — compute runway projection
  const cpuTrendQ = useDqlQuery(
    `timeseries cpu = avg(dt.host.cpu.usage), from: now()-30d, interval: 1d
| fieldsAdd trend_first = arrayFirst(cpu), trend_last = arrayLast(cpu)
| fieldsAdd growth_per_day = if(isNotNull(trend_first) and isNotNull(trend_last) and trend_last > trend_first, then: (trend_last - trend_first) / 29.0, else: 0.0)
| fieldsAdd days_runway = if(growth_per_day > 0, then: (85.0 - trend_last) / growth_per_day, else: null)
| fieldsAdd months_runway = if(isNotNull(days_runway) and days_runway > 0, then: days_runway / 30.0, else: null)`
  );

  // Deployment velocity last 30d
  const deployQ = useDqlQuery(
    `fetch events, from: now()-30d
| filter event.type == "CUSTOM_DEPLOYMENT" or event.type == "DEPLOYMENT_CHANGED" or contains(lower(toString(event.type)), "deploy")
| summarize deploys_30d = count()`
  );

  // Peak hourly event volume this week
  const peakLoadQ = useDqlQuery(
    `fetch user.events, from: now()-7d
| makeTimeseries evt_count = count(), interval: 1h
| fieldsAdd peak = arrayMax(evt_count), avg_hourly = arrayAvg(evt_count)`
  );

  // 30-day traffic sparkline
  const trafficTrendQ = useDqlQuery(
    `timeseries total = sum(dt.service.request.count), from: now()-30d, interval: 1d`
  );

  // 30-day CPU sparkline
  const cpuSparkQ = useDqlQuery(
    `timeseries cpu = avg(dt.host.cpu.usage), from: now()-30d, interval: 1d`
  );

  // Host count (distinct hosts with CPU data)
  const hostCountQ = useDqlQuery(
    `timeseries cpu = avg(dt.host.cpu.usage), by: {dt.entity.host}, from: now()-15m
| summarize host_count = count()`
  );

  // ── Derived values ──────────────────────────────────────────────────────────
  const curTotal = Number(trafficCurrentQ.records?.[0]?.cur_total ?? 0);
  const prevTotal = Number(trafficPriorQ.records?.[0]?.prev_total ?? 0);
  const wowGrowth = prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal) * 100 : null;

  const avgCpu = Number(cpuMemQ.records?.[0]?.avg_cpu ?? 0);
  const avgMem = Number(cpuMemQ.records?.[0]?.avg_mem ?? 0);

  const monthsRunwayRaw = cpuTrendQ.records?.[0]?.months_runway;
  const runwayMonths = monthsRunwayRaw != null ? Number(monthsRunwayRaw) : null;

  const deploys30d = Number(deployQ.records?.[0]?.deploys_30d ?? 0);
  const peakHrLoad = Number(peakLoadQ.records?.[0]?.peak ?? 0);
  const hostCount = Number(hostCountQ.records?.[0]?.host_count ?? 0);

  const trafficSparkData = useMemo(() => {
    const r = trafficTrendQ.records?.[0];
    if (!r) return [];
    return ((r.total as number[]) ?? []).map(v => Number(v ?? 0));
  }, [trafficTrendQ.records]);

  const cpuSparkData = useMemo(() => {
    const r = cpuSparkQ.records?.[0];
    if (!r) return [];
    return ((r.cpu as number[]) ?? []).map(v => Number(v ?? 0));
  }, [cpuSparkQ.records]);

  const cpuStatus: KpiStatus = avgCpu > 80 ? "critical" : avgCpu > 60 ? "warning" : "good";
  const memStatus: KpiStatus = avgMem > 85 ? "critical" : avgMem > 70 ? "warning" : "good";
  const runwayStatus: KpiStatus = runwayMonths === null ? "good" : runwayMonths < 3 ? "critical" : runwayMonths < 6 ? "warning" : "good";
  const growthStatus: KpiStatus = wowGrowth === null ? "neutral" : wowGrowth > 25 ? "warning" : "good";

  const { panel: aiPanel } = useAIAssist(useCallback(() =>
    analyzeCapacity({ wowGrowth, avgCpu, avgMem, runwayMonths, deploys30d, peakHrLoad, hostCount, curTotal, prevTotal }),
  [wowGrowth, avgCpu, avgMem, runwayMonths, deploys30d, peakHrLoad, hostCount, curTotal, prevTotal]));

  const { panel: dtPanel } = useDTIntelligence(4, useCallback(() =>
    buildDTPromptQ5({ wowGrowth, avgCpu, avgMem, runwayMonths, deploys30d, peakHrLoad, hostCount, curTotal, prevTotal }),
  [wowGrowth, avgCpu, avgMem, runwayMonths, deploys30d, peakHrLoad, hostCount, curTotal, prevTotal]));

  return (
    <TabPage
      question="Can we sustain tomorrow's growth — and are we ready for what's next?"
      subtitle="Capacity runway · Traffic growth · Platform delivery health"
    >
      {aiPanel}
      {dtPanel}
      {/* Row 1: 4 KPI tiles */}
      <GridRow columns="1fr 1fr 1fr 1fr" gap={12}>
        <KpiCard
          title="Traffic Growth — WoW"
          value={
            trafficCurrentQ.loading || trafficPriorQ.loading ? "—"
            : wowGrowth === null ? "N/A"
            : `${wowGrowth >= 0 ? "+" : ""}${wowGrowth.toFixed(1)}%`
          }
          subtitle={prevTotal > 0 ? `${fmtReq(prevTotal)} → ${fmtReq(curTotal)} requests` : "Comparing this week vs prior week"}
          status={growthStatus}
          loading={trafficCurrentQ.loading || trafficPriorQ.loading}
          trend={wowGrowth !== null && wowGrowth > 20 ? "⚠ High growth — validate headroom" : undefined}
          trendGood={false}
        />
        <KpiCard
          title="Capacity Runway (CPU)"
          value={
            cpuTrendQ.loading ? "—"
            : runwayMonths === null ? "Stable"
            : runwayMonths > 24 ? "> 24 mo"
            : `${runwayMonths.toFixed(1)} mo`
          }
          subtitle={`${avgCpu.toFixed(1)}% avg CPU now · ${hostCount} hosts · 85% sat. threshold`}
          status={runwayStatus}
          loading={cpuTrendQ.loading}
        />
        <KpiCard
          title="Peak Load — This Week"
          value={peakLoadQ.loading ? "—" : peakHrLoad.toLocaleString()}
          subtitle="Peak events / hr · all digital channels"
          status="neutral"
          loading={peakLoadQ.loading}
        />
        <KpiCard
          title="Deployment Velocity"
          value={deployQ.loading ? "—" : `${deploys30d}`}
          subtitle={`deploys / 30 days${deploys30d > 0 ? ` · ~${(30 / deploys30d).toFixed(1)} day cadence` : ""}`}
          status={deploys30d >= 10 ? "good" : deploys30d >= 3 ? "warning" : "neutral"}
          loading={deployQ.loading}
          trend={deploys30d >= 10 ? "Active CI/CD pipeline" : deploys30d >= 3 ? "Moderate delivery pace" : undefined}
          trendGood={deploys30d >= 10}
        />
      </GridRow>

      {/* Row 2: Infrastructure Saturation + 30-Day Traffic Trend */}
      <GridRow columns="1fr 1fr" gap={12}>
        {/* Infrastructure Saturation */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="Infrastructure Saturation" subtitle="Avg utilization across all monitored hosts · last 15 min">
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 4 }}>

              {/* CPU */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: "#c8cedf", fontWeight: 600 }}>CPU Utilization</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {cpuSparkData.length > 2 && (
                      <Sparkline
                        data={cpuSparkData}
                        color={cpuStatus === "good" ? "#00D26A" : cpuStatus === "warning" ? "#FCD53F" : "#F8312F"}
                        height={22} width={64}
                      />
                    )}
                    <span style={{ fontSize: 18, fontWeight: 700, color: cpuStatus === "good" ? "#00D26A" : cpuStatus === "warning" ? "#FCD53F" : "#F8312F", minWidth: 48, textAlign: "right" }}>
                      {cpuMemQ.loading ? "—" : fmtPct(avgCpu)}
                    </span>
                  </div>
                </div>
                <div style={{ height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden", position: "relative" }}>
                  <div style={{ height: "100%", width: `${Math.min(avgCpu, 100)}%`, background: cpuStatus === "good" ? "#00D26A" : cpuStatus === "warning" ? "#FCD53F" : "#F8312F", borderRadius: 5 }} />
                  <div style={{ position: "absolute", top: 0, left: "80%", width: 2, height: "100%", background: "rgba(255,255,255,0.3)" }} />
                </div>
                <div style={{ fontSize: 10, color: "#5c6480", marginTop: 3 }}>Warning ›60% · Critical ›80%</div>
              </div>

              {/* Memory */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: "#c8cedf", fontWeight: 600 }}>Memory Utilization</span>
                  <span style={{ fontSize: 18, fontWeight: 700, color: memStatus === "good" ? "#00D26A" : memStatus === "warning" ? "#FCD53F" : "#F8312F", minWidth: 48, textAlign: "right" }}>
                    {cpuMemQ.loading ? "—" : fmtPct(avgMem)}
                  </span>
                </div>
                <div style={{ height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 5, overflow: "hidden", position: "relative" }}>
                  <div style={{ height: "100%", width: `${Math.min(avgMem, 100)}%`, background: memStatus === "good" ? "#00D26A" : memStatus === "warning" ? "#FCD53F" : "#F8312F", borderRadius: 5 }} />
                  <div style={{ position: "absolute", top: 0, left: "85%", width: 2, height: "100%", background: "rgba(255,255,255,0.3)" }} />
                </div>
                <div style={{ fontSize: 10, color: "#5c6480", marginTop: 3 }}>Warning ›70% · Critical ›85%</div>
              </div>

              {/* Runway callout */}
              <div style={{
                padding: "10px 14px",
                background: runwayStatus === "good" ? "rgba(0,210,106,0.08)" : runwayStatus === "warning" ? "rgba(252,213,63,0.08)" : "rgba(248,49,47,0.08)",
                borderLeft: `3px solid ${runwayStatus === "good" ? "#00D26A" : runwayStatus === "warning" ? "#FCD53F" : "#F8312F"}`,
                borderRadius: 4,
              }}>
                <div style={{ fontSize: 11, color: "#8b92a8" }}>Capacity runway at current CPU growth rate</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: runwayStatus === "good" ? "#00D26A" : runwayStatus === "warning" ? "#FCD53F" : "#F8312F" }}>
                  {cpuTrendQ.loading ? "—" : runwayMonths === null ? "Stable — no growth trend detected" : runwayMonths > 24 ? "More than 24 months" : `${runwayMonths.toFixed(1)} months`}
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* 30-Day Traffic Trend */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="30-Day Traffic Trend" subtitle="Daily service request volume · all monitored services">
            {trafficTrendQ.loading ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
            ) : trafficSparkData.length < 2 ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>No traffic data in timeframe</div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <Sparkline data={trafficSparkData} color="#526cff" height={90} width={440} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "#5c6480" }}>
                  <span>30 days ago</span>
                  <span>Today</span>
                </div>
                <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#5c6480", textTransform: "uppercase", letterSpacing: 0.5 }}>This Week</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#526cff" }}>{fmtReq(curTotal)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#5c6480", textTransform: "uppercase", letterSpacing: 0.5 }}>Prior Week</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#8b92a8" }}>{fmtReq(prevTotal)}</div>
                  </div>
                  {wowGrowth !== null && (
                    <div>
                      <div style={{ fontSize: 10, color: "#5c6480", textTransform: "uppercase", letterSpacing: 0.5 }}>WoW Change</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: wowGrowth >= 0 ? "#00D26A" : "#F8312F" }}>
                        {wowGrowth >= 0 ? "+" : ""}{wowGrowth.toFixed(1)}%
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 10, color: "#5c6480", textTransform: "uppercase", letterSpacing: 0.5 }}>Peak Hr / Wk</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#c8cedf" }}>{peakHrLoad.toLocaleString()}</div>
                  </div>
                </div>
                {wowGrowth !== null && wowGrowth > 15 && (
                  <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(252,213,63,0.08)", border: "1px solid rgba(252,213,63,0.3)", borderRadius: 6, fontSize: 12, color: "#FCD53F" }}>
                    ⚠ Week-over-week growth above 15% — validate capacity headroom and scaling thresholds
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>
      </GridRow>
    </TabPage>
  );
};
