import React from "react";

export type KpiStatus = "good" | "warning" | "critical" | "neutral" | "info";

const STATUS_COLORS: Record<KpiStatus, { text: string; border: string; bg: string }> = {
  good:     { text: "#00D26A", border: "#00D26A", bg: "rgba(0,210,106,0.10)" },
  warning:  { text: "#FCD53F", border: "#FCD53F", bg: "rgba(252,213,63,0.10)" },
  critical: { text: "#F8312F", border: "#F8312F", bg: "rgba(248,49,47,0.10)" },
  neutral:  { text: "#c8cedf", border: "rgba(255,255,255,0.10)", bg: "rgba(255,255,255,0.04)" },
  info:     { text: "#7c9dff", border: "#526cff", bg: "rgba(82,108,255,0.10)" },
};

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: string;
  trendGood?: boolean;
  status?: KpiStatus;
  loading?: boolean;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title, value, subtitle, trend, trendGood, status = "neutral", loading, footer, children, style,
}) => {
  const colors = STATUS_COLORS[status];
  return (
    <div style={{
      background: colors.bg,
      border: `1.5px solid ${colors.border}`,
      borderRadius: 8,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      ...style,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8" }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: loading ? "#5c6480" : colors.text, lineHeight: 1.1 }}>
        {loading ? "—" : String(value)}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: "#8b92a8", marginTop: 2 }}>{subtitle}</div>
      )}
      {trend && (
        <div style={{ fontSize: 11, fontWeight: 600, color: trendGood === undefined ? "#8b92a8" : trendGood ? "#00D26A" : "#F8312F", marginTop: 2 }}>
          {trend}
        </div>
      )}
      {children}
      {footer && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#8b92a8", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 6 }}>
          {footer}
        </div>
      )}
    </div>
  );
};

// ── Inline sparkline using SVG ──────────────────────────────────────────────
interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}

export const Sparkline: React.FC<SparklineProps> = ({ data, color = "#00D26A", height = 32, width = 120 }) => {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// ── Section header ──────────────────────────────────────────────────────────
interface SectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({ title, subtitle, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#8b92a8" }}>
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 11, color: "#5c6480" }}>{subtitle}</div>}
    </div>
    {children}
  </div>
);

// ── Tab page wrapper ─────────────────────────────────────────────────────────
interface TabPageProps {
  question: string;
  subtitle?: string;
  children: React.ReactNode;
}

export const TabPage: React.FC<TabPageProps> = ({ question, subtitle, children }) => (
  <div style={{ padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#e8eaf0" }}>{question}</div>
        {subtitle && <div style={{ fontSize: 12, color: "#5c6480", marginTop: 2 }}>{subtitle}</div>}
      </div>
    </div>
    {children}
  </div>
);

// ── Grid row helper ──────────────────────────────────────────────────────────
interface GridRowProps {
  columns?: string;
  gap?: number;
  children: React.ReactNode;
}

export const GridRow: React.FC<GridRowProps> = ({ columns = "1fr 1fr 1fr", gap = 12, children }) => (
  <div style={{ display: "grid", gridTemplateColumns: columns, gap, alignItems: "stretch" }}>
    {children}
  </div>
);
