import React, { useMemo, useCallback } from "react";
import { useDqlQuery } from "../hooks/useDqlQuery";
import { useSettings } from "../SettingsContext";
import { KpiCard, Section, TabPage, GridRow } from "../components/KpiCard";
import type { KpiStatus } from "../components/KpiCard";
import { useAIAssist, analyzeSecurity } from "../components/AIAssist";
import { useDTIntelligence, buildDTPromptQ6 } from "../components/DynatraceIntelligence";

export const Q6SecurityTab: React.FC<{ timeframe: string }> = () => {
  const { settings } = useSettings();

  const loginFilter = settings.appNameFilter
    ? `| filter contains(lower(frontend.name), lower("${settings.appNameFilter}"))`
    : "";

  // Runtime security findings — last 24h
  const securityQ = useDqlQuery(
    `fetch security.events, from: now()-24h
| summarize critical = countIf(vulnerability.severityLevel == "CRITICAL"),
    high = countIf(vulnerability.severityLevel == "HIGH"),
    medium = countIf(vulnerability.severityLevel == "MEDIUM"),
    total = count()`
  );

  // Auth failure rate — last 1h
  const authNowQ = useDqlQuery(
    [
      `fetch user.events, from: now()-1h`,
      `| filter isNotNull(view.name)`,
      `| filter contains(lower(view.name), "login") or contains(lower(view.name), "sign") or contains(lower(view.name), "auth")`,
      loginFilter || null,
      `| summarize total = count(), failed = countIf(characteristics.has_error == true)`,
      `| fieldsAdd fail_rate = if(total > 0, then: failed * 100.0 / total, else: 0.0)`,
    ].filter(Boolean).join("\n")
  );

  // Auth failure rate — 7d baseline
  const authBaseQ = useDqlQuery(
    [
      `fetch user.events, from: now()-7d`,
      `| filter isNotNull(view.name)`,
      `| filter contains(lower(view.name), "login") or contains(lower(view.name), "sign") or contains(lower(view.name), "auth")`,
      loginFilter || null,
      `| summarize total = count(), failed = countIf(characteristics.has_error == true)`,
      `| fieldsAdd baseline_fail_rate = if(total > 0, then: failed * 100.0 / total, else: 0.0)`,
    ].filter(Boolean).join("\n")
  );

  // Auth anomaly timeline — last 24h, hourly
  const authTimelineQ = useDqlQuery(
    [
      `fetch user.events, from: now()-24h`,
      `| filter isNotNull(view.name)`,
      `| filter contains(lower(view.name), "login") or contains(lower(view.name), "sign") or contains(lower(view.name), "auth")`,
      loginFilter || null,
      `| makeTimeseries total = count(), failed = countIf(characteristics.has_error == true), interval: 1h`,
    ].filter(Boolean).join("\n")
  );

  // Deployment count last 30d (change control)
  const deployQ = useDqlQuery(
    `fetch events, from: now()-30d
| filter event.type == "CUSTOM_DEPLOYMENT" or event.type == "DEPLOYMENT_CHANGED" or contains(lower(toString(event.type)), "deploy")
| summarize deploys_30d = count()`
  );

  // Open problems (incident readiness)
  const problemsQ = useDqlQuery(
    `fetch dt.davis.problems, from: now()-2h
| filter status == "OPEN"
| summarize open_problems = count(), critical = countIf(severityLevel == "AVAILABILITY" or severityLevel == "ERROR")`
  );

  // SLA compliance MTD
  const slaMtdQ = useDqlQuery(
    `timeseries {
  total = sum(dt.service.request.count),
  failures = sum(dt.service.request.failure_count)
}, from: now()@M
| fieldsAdd total_req = arraySum(total), total_fail = arraySum(failures)
| fieldsAdd availability = if(total_req > 0, then: (total_req - total_fail) * 100.0 / total_req, else: 100.0)`
  );

  // ── Derived values ──────────────────────────────────────────────────────────
  const criticalVulns = Number(securityQ.records?.[0]?.critical ?? 0);
  const highVulns = Number(securityQ.records?.[0]?.high ?? 0);
  const mediumVulns = Number(securityQ.records?.[0]?.medium ?? 0);
  const totalFindings = Number(securityQ.records?.[0]?.total ?? 0);

  const authFailNow = Number(authNowQ.records?.[0]?.fail_rate ?? 0);
  const authTotalNow = Number(authNowQ.records?.[0]?.total ?? 0);
  const authFailBaseline = Number(authBaseQ.records?.[0]?.baseline_fail_rate ?? 0);
  const authAnomalyMultiple = authFailBaseline > 0 ? authFailNow / authFailBaseline : null;
  const authIsAnomaly = authAnomalyMultiple !== null && authAnomalyMultiple > 2;

  const deploys30d = Number(deployQ.records?.[0]?.deploys_30d ?? 0);
  const openProblems = Number(problemsQ.records?.[0]?.open_problems ?? 0);
  const criticalProblems = Number(problemsQ.records?.[0]?.critical ?? 0);
  const slaAvailability = Number(slaMtdQ.records?.[0]?.availability ?? 100);
  const slaTarget = settings.serviceSlaTargetPct;
  const slaMtdOk = slaAvailability >= slaTarget;

  // Composite compliance score — 4 pillars × 25 pts each
  const pillarSecurity = criticalVulns === 0 ? 25 : Math.max(0, 25 - criticalVulns * 5);
  const pillarAuth = !authIsAnomaly ? 25 : authAnomalyMultiple !== null ? Math.max(0, 25 - Math.round((authAnomalyMultiple - 1) * 8)) : 0;
  const pillarProblems = criticalProblems === 0 ? 25 : Math.max(0, 25 - criticalProblems * 8);
  const pillarSla = slaMtdOk ? 25 : Math.max(0, Math.round((slaAvailability - (slaTarget - 2)) * 12.5));
  const complianceScore = pillarSecurity + pillarAuth + pillarProblems + pillarSla;

  const complianceStatus: KpiStatus = complianceScore >= 90 ? "good" : complianceScore >= 70 ? "warning" : "critical";
  const securityStatus: KpiStatus = criticalVulns > 0 ? "critical" : highVulns > 0 ? "warning" : "good";
  const authStatus: KpiStatus = authIsAnomaly ? "critical" : authFailNow > 5 ? "warning" : "good";

  const authTimelineData = useMemo(() => {
    const r = authTimelineQ.records?.[0];
    if (!r) return [];
    const totals = (r.total as number[]) ?? [];
    const failed = (r.failed as number[]) ?? [];
    return totals.map((t, i) => {
      const f = Number(failed[i] ?? 0);
      return t > 0 ? (f / t) * 100 : 0;
    });
  }, [authTimelineQ.records]);

  const maxAuthRate = Math.max(...authTimelineData, authFailBaseline * 2.5, 1);

  // NCUA exam readiness checklist
  const auditChecks = [
    {
      label: "Runtime security — no critical findings",
      ok: criticalVulns === 0,
      detail: criticalVulns > 0
        ? `${criticalVulns} critical finding${criticalVulns > 1 ? "s" : ""} require remediation`
        : highVulns > 0 ? `${highVulns} high-severity finding${highVulns > 1 ? "s" : ""} — review recommended` : "Clean — no active findings",
    },
    {
      label: "Authentication — no anomalies detected",
      ok: !authIsAnomaly,
      detail: authIsAnomaly
        ? `${authFailNow.toFixed(1)}% failure rate — ${authAnomalyMultiple?.toFixed(1)}× above 7-day baseline`
        : authTotalNow === 0 ? "No auth traffic in last hour"
        : `${authFailNow.toFixed(1)}% failure rate — within baseline (${authFailBaseline.toFixed(1)}%)`,
    },
    {
      label: "SLA compliance — MTD target met",
      ok: slaMtdOk,
      detail: `${slaAvailability.toFixed(3)}% MTD availability — target ${slaTarget}%${slaMtdOk ? ` (+${(slaAvailability - slaTarget).toFixed(3)} pt)` : ` (−${(slaTarget - slaAvailability).toFixed(3)} pt below target)`}`,
    },
    {
      label: "No open critical incidents",
      ok: criticalProblems === 0,
      detail: criticalProblems > 0
        ? `${criticalProblems} critical problem${criticalProblems > 1 ? "s" : ""} currently open`
        : openProblems > 0 ? `${openProblems} minor open problem${openProblems > 1 ? "s" : ""} — not member-impacting`
        : "All clear — no open problems",
    },
    {
      label: "Change control — active deployment pipeline",
      ok: deploys30d > 0,
      detail: deploys30d > 0
        ? `${deploys30d} deployment${deploys30d > 1 ? "s" : ""} recorded in last 30 days — audit trail present`
        : "No recent deployments detected",
    },
  ];

  const passingCount = auditChecks.filter(c => c.ok).length;

  const { panel: aiPanel } = useAIAssist(useCallback(() =>
    analyzeSecurity({ complianceScore, criticalVulns, highVulns, mediumVulns, authIsAnomaly, authFailNow, authFailBaseline, authAnomalyMultiple, passingCount, deploys30d, openProblems, criticalProblems, slaOk: slaMtdOk, slaAvailability, slaTarget }),
  [complianceScore, criticalVulns, highVulns, mediumVulns, authIsAnomaly, authFailNow, authFailBaseline, authAnomalyMultiple, passingCount, deploys30d, openProblems, criticalProblems, slaMtdOk, slaAvailability, slaTarget]));

  const { panel: dtPanel } = useDTIntelligence(5, useCallback(() =>
    buildDTPromptQ6({ complianceScore, criticalVulns, highVulns, mediumVulns, authIsAnomaly, authFailNow, authFailBaseline, authAnomalyMultiple, passingCount, deploys30d, openProblems, criticalProblems, slaOk: slaMtdOk, slaAvailability, slaTarget }),
  [complianceScore, criticalVulns, highVulns, mediumVulns, authIsAnomaly, authFailNow, authFailBaseline, authAnomalyMultiple, passingCount, deploys30d, openProblems, criticalProblems, slaMtdOk, slaAvailability, slaTarget]));

  return (
    <TabPage
      question="Are we protecting members and staying compliant?"
      subtitle="Security posture · Authentication anomalies · NCUA examination readiness"
    >
      {aiPanel}
      {dtPanel}
      {/* Row 1: 4 KPI tiles */}
      <GridRow columns="1fr 1fr 1fr 1fr" gap={12}>
        <KpiCard
          title="Compliance Score"
          value={(securityQ.loading || slaMtdQ.loading) ? "—" : `${complianceScore}/100`}
          subtitle={`${passingCount}/5 NCUA pillars passing`}
          status={complianceStatus}
          loading={securityQ.loading || slaMtdQ.loading}
        >
          {!(securityQ.loading || slaMtdQ.loading) && (
            <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 6 }}>
              <div style={{
                height: "100%", width: `${complianceScore}%`, borderRadius: 2,
                background: complianceStatus === "good" ? "#00D26A" : complianceStatus === "warning" ? "#FCD53F" : "#F8312F",
              }} />
            </div>
          )}
        </KpiCard>

        <KpiCard
          title="Security Findings — 24h"
          value={securityQ.loading ? "—" : criticalVulns > 0 ? `${criticalVulns} CRITICAL` : highVulns > 0 ? `${highVulns} HIGH` : "Clean"}
          subtitle={totalFindings > 0 ? `${criticalVulns} critical · ${highVulns} high · ${mediumVulns} medium` : "No active vulnerability findings"}
          status={securityStatus}
          loading={securityQ.loading}
        />

        <KpiCard
          title="Auth Failure Rate — Now"
          value={authNowQ.loading ? "—" : authTotalNow === 0 ? "No traffic" : `${authFailNow.toFixed(1)}%`}
          subtitle={
            authAnomalyMultiple !== null && authTotalNow > 0
              ? `${authAnomalyMultiple.toFixed(1)}× 7-day baseline (${authFailBaseline.toFixed(1)}%)`
              : "Login / auth views · last 1h"
          }
          status={authStatus}
          loading={authNowQ.loading}
          trend={authIsAnomaly ? "⚠ Possible credential stuffing or fraud" : undefined}
          trendGood={false}
        />

        <KpiCard
          title="Change Control — 30d"
          value={deployQ.loading ? "—" : `${deploys30d}`}
          subtitle={deploys30d > 0 ? `deployments with audit trail · ${(30 / Math.max(deploys30d, 1)).toFixed(1)}d cadence` : "No recent deployments detected"}
          status={deploys30d > 0 ? "good" : "warning"}
          loading={deployQ.loading}
        />
      </GridRow>

      {/* Row 2: NCUA Checklist + Auth Anomaly / Security Breakdown */}
      <GridRow columns="1fr 1fr" gap={12}>
        {/* NCUA Audit Readiness Checklist */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <Section title="NCUA Examination Readiness" subtitle="Real-time posture across 5 key examination areas">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
              {auditChecks.map((check) => (
                <div key={check.label} style={{
                  display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px",
                  background: check.ok ? "rgba(0,210,106,0.07)" : "rgba(248,49,47,0.07)",
                  border: `1px solid ${check.ok ? "rgba(0,210,106,0.22)" : "rgba(248,49,47,0.3)"}`,
                  borderRadius: 6,
                }}>
                  <span style={{
                    fontSize: 13, lineHeight: 1.2, flexShrink: 0, marginTop: 1,
                    color: check.ok ? "#00D26A" : "#F8312F", fontWeight: 700,
                  }}>
                    {check.ok ? "✓" : "✗"}
                  </span>
                  <div>
                    <div style={{ fontSize: 12, color: "#e8eaf0", fontWeight: check.ok ? 400 : 600 }}>
                      {check.label}
                    </div>
                    <div style={{ fontSize: 11, color: check.ok ? "#5c6480" : "#FCD53F", marginTop: 2 }}>
                      {check.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Auth anomaly chart + security severity breakdown */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16,
        }}>
          {/* Auth failure rate timeline */}
          <Section title="Authentication Failure Rate — 24h" subtitle="Hourly · login / sign-in / auth views">
            {authTimelineQ.loading ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
            ) : authTimelineData.length < 2 ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>No auth event data in timeframe</div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 56, marginTop: 6 }}>
                  {authTimelineData.map((v, i) => {
                    const heightPct = Math.max(v / maxAuthRate, 0.04);
                    const color = v > authFailBaseline * 2 ? "#F8312F" : v > authFailBaseline * 1.3 ? "#FCD53F" : "#00D26A";
                    return (
                      <div
                        key={i}
                        style={{
                          flex: 1, background: color, borderRadius: "2px 2px 0 0", opacity: 0.85,
                          height: `${heightPct * 100}%`, minHeight: 3,
                        }}
                        title={`${authTimelineData.length - i}h ago: ${v.toFixed(1)}% fail rate`}
                      />
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#5c6480", marginTop: 3 }}>
                  <span>24h ago</span>
                  <span>Now</span>
                </div>
                <div style={{ fontSize: 11, color: "#8b92a8", marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>7-day baseline: <strong style={{ color: "#c8cedf" }}>{authFailBaseline.toFixed(1)}%</strong></span>
                  <span>Current (1h): <strong style={{ color: authStatus === "good" ? "#00D26A" : authStatus === "warning" ? "#FCD53F" : "#F8312F" }}>{authFailNow.toFixed(1)}%</strong></span>
                  {authIsAnomaly && <span style={{ color: "#F8312F", fontWeight: 700 }}>ANOMALY DETECTED</span>}
                </div>
              </div>
            )}
          </Section>

          {/* Security severity breakdown */}
          <Section title="Vulnerability Severity Breakdown" subtitle="Runtime security findings · last 24h">
            {securityQ.loading ? (
              <div style={{ color: "#5c6480", fontSize: 12 }}>Loading…</div>
            ) : totalFindings === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 0" }}>
                <div style={{ fontSize: 28, color: "#00D26A" }}>✓</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#00D26A" }}>No active security findings</div>
                <div style={{ fontSize: 11, color: "#5c6480" }}>Runtime Application Security · last 24 hours</div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                {[
                  { label: "Critical", count: criticalVulns, color: "#F8312F" },
                  { label: "High", count: highVulns, color: "#FCD53F" },
                  { label: "Medium", count: mediumVulns, color: "#8b92a8" },
                ].map(({ label, count, color }) => (
                  <div key={label} style={{
                    flex: 1, padding: "10px 12px", textAlign: "center",
                    background: count > 0 ? `${color}18` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${count > 0 ? color : "rgba(255,255,255,0.06)"}`,
                    borderRadius: 6,
                  }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: count > 0 ? color : "#5c6480" }}>{count}</div>
                    <div style={{ fontSize: 10, color: "#8b92a8", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </GridRow>
    </TabPage>
  );
};
