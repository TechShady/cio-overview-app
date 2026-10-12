import React from "react";
import { useDqlQuery } from "../hooks/useDqlQuery";
import { useSettings } from "../SettingsContext";
import { ensureStyles } from "./AIAssist";

// ── Narrative generator ───────────────────────────────────────────────────────
function generateNarrative(p: {
  openProblems: number; errorRate: number; membersOnline: number;
  membersImpacted: number; activeIncidents: number; slaAvailability: number;
  slaTarget: number; slaOk: boolean; deploysToday: number;
  avgCpu: number; avgMem: number; criticalVulns: number; overallStatus: string;
}): string {
  const opener = p.overallStatus === "good"
    ? "VyStar's digital banking platform is operating in a healthy state across all six CIO domains."
    : p.overallStatus === "warning"
    ? `VyStar's platform is largely operational with ${p.openProblems > 0 || p.activeIncidents > 0 ? "some active items requiring attention" : "a few metrics to watch"}.`
    : "VyStar's platform is experiencing active issues that require immediate leadership attention.";

  const memberSentence = p.activeIncidents > 0
    ? `A major incident is currently active, impacting ${p.membersImpacted.toLocaleString()} of ${p.membersOnline.toLocaleString()} active members — full incident response should be engaged immediately.`
    : `${p.membersOnline.toLocaleString()} members are active in digital banking right now with ${p.membersImpacted === 0 ? "zero member-impacting issues" : `${p.membersImpacted.toLocaleString()} sessions experiencing errors`}.`;

  const slaSentence = `Service availability MTD stands at ${p.slaAvailability.toFixed(3)}%, which is ${p.slaOk ? `${(p.slaAvailability - p.slaTarget).toFixed(3)} points above` : `${(p.slaTarget - p.slaAvailability).toFixed(3)} points below`} the ${p.slaTarget}% contractual target — SLA obligations are ${p.slaOk ? "being met" : "at risk and require remediation"}.`;

  const techSentence = `${p.deploysToday > 0 ? `Engineering shipped ${p.deploysToday} release${p.deploysToday !== 1 ? "s" : ""} today` : "No deployments occurred today"}, and infrastructure is running at ${p.avgCpu.toFixed(0)}% CPU / ${p.avgMem.toFixed(0)}% memory utilization — ${p.avgCpu < 70 && p.avgMem < 80 ? "well within safe operating bounds" : "elevated and should be monitored"}.`;

  const secSentence = p.criticalVulns > 0
    ? `Security requires immediate attention: ${p.criticalVulns} critical runtime vulnerabilit${p.criticalVulns !== 1 ? "ies" : "y"} detected in the last 24 hours, with direct NCUA compliance implications.`
    : `Security and compliance posture is clean — no critical runtime vulnerabilities in the last 24 hours, keeping NCUA examination readiness strong.`;

  return [opener, memberSentence, slaSentence, techSentence, secSentence].join(" ");
}

// ── Modal content (runs queries only when mounted = only when open) ────────────
function CIOBriefContent({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings();
  const slaTarget = settings.serviceSlaTargetPct;
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Service health
  const problemsQ = useDqlQuery(
    `fetch dt.davis.problems, from: now()-2h
| filter status == "OPEN"
| summarize open_problems = count(), critical = countIf(severityLevel == "AVAILABILITY" or severityLevel == "ERROR")`
  );

  const errorRateQ = useDqlQuery(
    `timeseries { total = sum(dt.service.request.count), fail = sum(dt.service.request.failure_count) }, from: now()-1h
| fieldsAdd err = if(arraySum(total) > 0, then: arraySum(fail) * 100.0 / arraySum(total), else: 0.0)
| fields err`
  );

  // Member impact
  const membersQ = useDqlQuery(
    `fetch user.events, from: now()-15m
| summarize members_online = countDistinct(dt.rum.browser.session_id)`
  );

  const impactedQ = useDqlQuery(
    `fetch user.sessions, from: now()-5m
| filter error.count > 0 or error.has_crash == true
| summarize members_impacted = count()`
  );

  const incidentsQ = useDqlQuery(
    `fetch dt.davis.problems, from: now()-2h
| filter status == "OPEN"
| filter impactLevel == "APPLICATION" or impactLevel == "ENVIRONMENT"
| summarize active_incidents = count()`
  );

  // SLA MTD
  const slaQ = useDqlQuery(
    `timeseries { total = sum(dt.service.request.count), fail = sum(dt.service.request.failure_count) }, from: now()@M
| fieldsAdd total_req = arraySum(total), total_fail = arraySum(fail)
| fieldsAdd availability = if(total_req > 0, then: (total_req - total_fail) * 100.0 / total_req, else: 100.0)`
  );

  // Deployments today
  const deploysQ = useDqlQuery(
    `fetch events, from: now()-24h
| filter event.type == "CUSTOM_DEPLOYMENT" or event.type == "DEPLOYMENT_CHANGED" or contains(lower(toString(event.type)), "deploy")
| summarize deploys_today = count()`
  );

  // Infrastructure
  const cpuQ = useDqlQuery(
    `timeseries cpu = avg(dt.host.cpu.usage), from: now()-1h
| fieldsAdd avg_cpu = arrayAvg(cpu)`
  );

  const memQ = useDqlQuery(
    `timeseries mem = avg(dt.host.memory.usage), from: now()-1h
| fieldsAdd avg_mem = arrayAvg(mem)`
  );

  // Security
  const secQ = useDqlQuery(
    `fetch security.events, from: now()-24h
| summarize critical = countIf(vulnerability.severityLevel == "CRITICAL"),
    high = countIf(vulnerability.severityLevel == "HIGH"),
    total = count()`
  );

  const authQ = useDqlQuery(
    `fetch user.events, from: now()-1h
| filter isNotNull(view.name)
| filter contains(lower(view.name), "login") or contains(lower(view.name), "sign") or contains(lower(view.name), "auth")
| summarize total = count(), failed = countIf(characteristics.has_error == true)
| fieldsAdd fail_rate = if(total > 0, then: failed * 100.0 / total, else: 0.0)`
  );

  // ── Derived values ──────────────────────────────────────────────────────────
  const openProblems   = Number(problemsQ.records?.[0]?.open_problems ?? 0);
  const criticalProbs  = Number(problemsQ.records?.[0]?.critical ?? 0);
  const errorRate      = Number(errorRateQ.records?.[0]?.err ?? 0);
  const membersOnline  = Number(membersQ.records?.[0]?.members_online ?? 0);
  const membersImpacted = Number(impactedQ.records?.[0]?.members_impacted ?? 0);
  const activeIncidents = Number(incidentsQ.records?.[0]?.active_incidents ?? 0);
  const slaAvailability = Number(slaQ.records?.[0]?.availability ?? 100);
  const slaOk          = slaAvailability >= slaTarget;
  const deploysToday   = Number(deploysQ.records?.[0]?.deploys_today ?? 0);
  const avgCpu         = Number(cpuQ.records?.[0]?.avg_cpu ?? 0);
  const avgMem         = Number(memQ.records?.[0]?.avg_mem ?? 0);
  const criticalVulns  = Number(secQ.records?.[0]?.critical ?? 0);
  const highVulns      = Number(secQ.records?.[0]?.high ?? 0);
  const authFail       = Number(authQ.records?.[0]?.fail_rate ?? 0);
  const authTotal      = Number(authQ.records?.[0]?.total ?? 0);

  const isLoading = [problemsQ, errorRateQ, membersQ, impactedQ, incidentsQ, slaQ, deploysQ, cpuQ, memQ, secQ, authQ].some(q => q.loading);

  // ── Domain status ───────────────────────────────────────────────────────────
  type DomainStatus = "good" | "warning" | "critical";
  const serviceStatus: DomainStatus = openProblems > 0 && errorRate > 2 ? "critical" : openProblems > 0 || errorRate > 0.5 ? "warning" : "good";
  const memberStatus:  DomainStatus = activeIncidents > 0 ? "critical" : membersImpacted > 0 ? "warning" : "good";
  const riskStatus:    DomainStatus = !slaOk ? "warning" : errorRate > 2 ? "critical" : "good";
  const changeStatus:  DomainStatus = criticalProbs > 0 ? "critical" : openProblems > 0 ? "warning" : "good";
  const capacityStatus: DomainStatus = avgCpu > 80 || avgMem > 85 ? "critical" : avgCpu > 60 || avgMem > 70 ? "warning" : "good";
  const securityStatus: DomainStatus = criticalVulns > 0 ? "critical" : highVulns > 0 ? "warning" : "good";

  const domains = [
    {
      label: "Service Health",
      status: serviceStatus,
      detail: openProblems > 0
        ? `${openProblems} active Davis problem${openProblems !== 1 ? "s" : ""}. API error rate ${errorRate.toFixed(2)}%.`
        : `No active problems. API error rate ${errorRate.toFixed(2)}% — within bounds.`,
    },
    {
      label: "Member Experience",
      status: memberStatus,
      detail: activeIncidents > 0
        ? `${activeIncidents} major incident active. ${membersImpacted.toLocaleString()} members impacted.`
        : `${membersOnline.toLocaleString()} members active. ${membersImpacted === 0 ? "Zero members impacted." : `${membersImpacted.toLocaleString()} sessions with errors.`}`,
    },
    {
      label: "Business Risk",
      status: riskStatus,
      detail: `SLA ${slaAvailability.toFixed(3)}% MTD — ${slaOk ? `${(slaAvailability - slaTarget).toFixed(3)} pts above` : `${(slaTarget - slaAvailability).toFixed(3)} pts below`} ${slaTarget}% target.`,
    },
    {
      label: "Engineering Velocity",
      status: changeStatus,
      detail: `${deploysToday} deployment${deploysToday !== 1 ? "s" : ""} today. ${criticalProbs === 0 ? "No critical incidents open." : `${criticalProbs} critical incident${criticalProbs !== 1 ? "s" : ""} open.`}`,
    },
    {
      label: "Capacity & Infrastructure",
      status: capacityStatus,
      detail: `CPU ${avgCpu.toFixed(0)}%, Memory ${avgMem.toFixed(0)}%. ${avgCpu < 60 && avgMem < 70 ? "Infrastructure healthy." : "Utilization elevated — review auto-scaling."}`,
    },
    {
      label: "Security & Compliance",
      status: securityStatus,
      detail: criticalVulns > 0
        ? `${criticalVulns} critical vuln${criticalVulns !== 1 ? "s" : ""} — immediate remediation required.`
        : !authQ.loading && authTotal > 0 && authFail > 15
        ? `Auth failure rate elevated at ${authFail.toFixed(1)}% — monitor for credential attacks.`
        : "No critical findings. NCUA compliance posture strong.",
    },
  ];

  const anyBad  = domains.some(d => d.status === "critical");
  const anyWarn = domains.some(d => d.status === "warning");
  const overallStatus  = anyBad ? "critical" : anyWarn ? "warning" : "good";
  const overallLabel   = overallStatus === "good" ? "All Systems Healthy" : overallStatus === "warning" ? "Monitoring — Items Need Attention" : "Active Issues Require Attention";
  const overallColor   = overallStatus === "good" ? "#00D26A" : overallStatus === "warning" ? "#FCD53F" : "#F8312F";

  const narrative = generateNarrative({ openProblems, errorRate, membersOnline, membersImpacted, activeIncidents, slaAvailability, slaTarget, slaOk, deploysToday, avgCpu, avgMem, criticalVulns, overallStatus });

  const sc = (s: string) => s === "good" ? "#00D26A" : s === "warning" ? "#FCD53F" : "#F8312F";
  const sl = (s: string) => s === "good" ? "HEALTHY" : s === "warning" ? "WATCHING" : "ATTENTION";
  const printSc = (s: string) => s === "good" ? "#16a34a" : s === "warning" ? "#d97706" : "#dc2626";
  const printBg = (s: string) => s === "good" ? "#f0fdf4" : s === "warning" ? "#fffbeb" : "#fef2f2";
  const printBorder = (s: string) => s === "good" ? "#86efac" : s === "warning" ? "#fcd34d" : "#fca5a5";

  const handleExportPdf = () => {
    const domainRows = domains.map(d => `
      <div class="domain-row">
        <div class="domain-label">${d.label}</div>
        <div class="status-pill">
          <div class="dot" style="background:${printSc(d.status)}"></div>
          <span class="status-text" style="color:${printSc(d.status)}">${sl(d.status)}</span>
        </div>
        <div class="domain-detail">${d.detail}</div>
      </div>`).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>VyStar CIO Executive Brief — ${dateStr}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px;color:#1a1f36;background:#fff;font-size:13px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #e5e7ef}
  .title{font-size:20px;font-weight:800;color:#1a1f36;display:flex;align-items:center;gap:8px}
  .subtitle{font-size:11px;color:#6b7280;margin-top:4px}
  .overall{display:flex;align-items:center;gap:10px;padding:11px 16px;border-radius:8px;margin-bottom:18px;font-weight:700;font-size:13px;background:${printBg(overallStatus)};border:1px solid ${printBorder(overallStatus)};color:${printSc(overallStatus)}}
  .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
  .domains{border:1px solid #e5e7ef;border-radius:8px;overflow:hidden;margin-bottom:22px}
  .domain-row{display:grid;grid-template-columns:190px 90px 1fr;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid #f3f4f6}
  .domain-row:last-child{border-bottom:none}
  .domain-label{font-size:12px;font-weight:700;color:#1a1f36}
  .status-pill{display:flex;align-items:center;gap:5px}
  .status-text{font-size:10px;font-weight:700}
  .domain-detail{font-size:12px;color:#4b5563;line-height:1.45}
  .section-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;margin-bottom:8px}
  .narrative-box{padding:16px;background:#f8f7ff;border-left:4px solid #7c3aed;border-radius:4px;font-size:13px;line-height:1.7;color:#374151}
  .footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7ef;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
  @media print{body{padding:20px}@page{margin:1cm}}
</style></head>
<body>
  <div class="header">
    <div>
      <div class="title">&#10022; VyStar CIO Executive Brief</div>
      <div class="subtitle">Live from Dynatrace &middot; ${dateStr} &middot; ${timeStr}</div>
    </div>
    <div style="font-size:11px;color:#6b7280;text-align:right">VyStar Credit Union<br>Technology &amp; Member Experience</div>
  </div>
  <div class="overall">
    <div class="dot" style="background:${printSc(overallStatus)}"></div>
    ${overallLabel}
  </div>
  <div class="domains">${domainRows}</div>
  <div class="section-label">Executive Narrative</div>
  <div class="narrative-box">${narrative}</div>
  <div class="footer">
    <span>Generated by Dynatrace CIO Overview &middot; my.cio.overview</span>
    <span>${dateStr} ${timeStr}</span>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 400);</script>
</body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "#0d1117", border: "1px solid rgba(165,110,255,0.3)", borderRadius: 12, width: "min(700px, 95vw)", maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.7)" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <path d="M12 2L13.5 10.5L22 12L13.5 13.5L12 22L10.5 13.5L2 12L10.5 10.5Z" fill="#c084fc" />
              </svg>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#e8eaf0" }}>VyStar CIO Executive Brief</span>
            </div>
            <div style={{ fontSize: 11, color: "#5c6480", marginTop: 3 }}>Live from Dynatrace · {dateStr} · {timeStr}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleExportPdf}
              style={{ background: "rgba(165,110,255,0.12)", border: "1px solid rgba(165,110,255,0.3)", color: "#c084fc", fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6, cursor: "pointer" }}
            >
              PDF
            </button>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#5c6480", fontSize: 18, cursor: "pointer", padding: "2px 8px", lineHeight: 1 }}>✕</button>
          </div>
        </div>

        {/* Overall status bar */}
        <div style={{ padding: "10px 24px", background: `rgba(${overallStatus === "good" ? "0,210,106" : overallStatus === "warning" ? "252,213,63" : "248,49,47"},0.07)`, borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: overallColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: overallColor }}>{overallLabel}</span>
          {isLoading && <span style={{ fontSize: 11, color: "#5c6480", marginLeft: "auto" }}>Fetching live data…</span>}
        </div>

        {/* Domain rows */}
        <div style={{ padding: "14px 24px", display: "flex", flexDirection: "column", gap: 4 }}>
          {domains.map((d) => (
            <div key={d.label} style={{ display: "grid", gridTemplateColumns: "190px 90px 1fr", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 6, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e8eaf0" }}>{d.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: sc(d.status), flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: sc(d.status) }}>{sl(d.status)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#8b92a8", lineHeight: 1.45 }}>{d.detail}</div>
            </div>
          ))}
        </div>

        {/* Narrative */}
        <div style={{ padding: "0 24px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#5c6480", marginBottom: 8 }}>Executive Narrative</div>
          <div style={{ background: "rgba(165,110,255,0.05)", border: "1px solid rgba(165,110,255,0.1)", borderRadius: 8, padding: "14px 16px", fontSize: 13, lineHeight: 1.65, color: "#c8cedf" }}>
            {narrative}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────
export function CIOBriefButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  ensureStyles();
  return (
    <button className={`cio-ai-assist-btn${open ? " active" : ""}`} onClick={onToggle} title="CIO Executive Brief — 60-second cross-domain summary">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="#c084fc" strokeWidth="2.5" />
        <line x1="7" y1="8" x2="17" y2="8" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" />
        <line x1="7" y1="12" x2="17" y2="12" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" />
        <line x1="7" y1="16" x2="13" y2="16" stroke="#c084fc" strokeWidth="2" strokeLinecap="round" />
      </svg>
      CIO Brief
    </button>
  );
}

export function CIOBriefModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <CIOBriefContent onClose={onClose} />;
}
