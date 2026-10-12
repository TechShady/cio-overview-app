import React, { useState, useCallback, useEffect } from "react";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { SettingsProvider, useSettings } from "./SettingsContext";
import { TimeframePicker } from "./components/TimeframePicker";
import { SettingsDialog } from "./components/SettingsDialog";
import { AIAssistContext, AIAssistButton } from "./components/AIAssist";
import { DTIntelligenceContext, DTIntelligenceButton } from "./components/DynatraceIntelligence";
import { CIOBriefButton, CIOBriefModal } from "./components/CIOBrief";
import { Q1ServiceHealthTab } from "./tabs/Q1ServiceHealthTab";
import { Q2MemberImpactTab } from "./tabs/Q2MemberImpactTab";
import { Q3BusinessRiskTab } from "./tabs/Q3BusinessRiskTab";
import { Q4ChangeIntelTab } from "./tabs/Q4ChangeIntelTab";
import { Q5CapacityTab } from "./tabs/Q5CapacityTab";
import { Q6SecurityTab } from "./tabs/Q6SecurityTab";
import { VYSTAR_LOGO } from "../assets/VystarLogo";

const AppInner = () => {
  const { settings } = useSettings();
  const [timeframe, setTimeframe] = useState("1h");
  const [activeTab, setActiveTab] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [dtOpen, setDtOpen] = useState(false);
  const [cioBriefOpen, setCioBriefOpen] = useState(false);

  const toggleAi = useCallback(() => setAiOpen((v) => !v), []);
  const closeAi = useCallback(() => setAiOpen(false), []);
  const toggleDt = useCallback(() => setDtOpen((v) => !v), []);
  const closeDt = useCallback(() => setDtOpen(false), []);
  const toggleCioBrief = useCallback(() => setCioBriefOpen((v) => !v), []);
  const closeCioBrief = useCallback(() => setCioBriefOpen(false), []);

  // Close panels when their feature is disabled in settings
  useEffect(() => { if (!settings.aiAssistEnabled) setAiOpen(false); }, [settings.aiAssistEnabled]);
  useEffect(() => { if (!settings.dtIntelligenceEnabled) setDtOpen(false); }, [settings.dtIntelligenceEnabled]);

  const aiContextValue = React.useMemo(() => ({ open: aiOpen, close: closeAi }), [aiOpen, closeAi]);
  const dtContextValue = React.useMemo(() => ({ open: dtOpen, close: closeDt, activeTab }), [dtOpen, closeDt, activeTab]);

  return (
    <>
      <AIAssistContext.Provider value={aiContextValue}>
      <DTIntelligenceContext.Provider value={dtContextValue}>
        <Page>
          <Page.Main>
            <div style={{ position: "relative" }}>
              {/* VyStar logo — sits to the left of both header rows */}
              <img
                src={VYSTAR_LOGO}
                alt="VyStar Credit Union"
                style={{
                  position: "absolute",
                  top: 4,
                  left: 12,
                  height: 40,
                  zIndex: 10,
                  pointerEvents: "none",
                }}
              />

              {/* Pills row — own row, left-padded to clear logo, right-aligned */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  padding: "6px 16px 6px 68px",
                }}
              >
                <CIOBriefButton open={cioBriefOpen} onToggle={toggleCioBrief} />
                {settings.dtIntelligenceEnabled && <DTIntelligenceButton open={dtOpen} onToggle={toggleDt} />}
                {settings.aiAssistEnabled && <AIAssistButton open={aiOpen} onToggle={toggleAi} />}
                <SettingsDialog />
                <TimeframePicker value={timeframe} onChange={setTimeframe} />
              </div>

              {/* Tab strip — indent to clear the logo */}
              <div style={{ paddingLeft: 68 }}>
                <Tabs selectedIndex={activeTab} onChange={setActiveTab}>
                  <Tab title="Q1 · Service Health">
                    <Q1ServiceHealthTab timeframe={timeframe} />
                  </Tab>
                  <Tab title="Q2 · Member Impact">
                    <Q2MemberImpactTab timeframe={timeframe} />
                  </Tab>
                  <Tab title="Q3 · Business Risk">
                    <Q3BusinessRiskTab timeframe={timeframe} />
                  </Tab>
                  <Tab title="Q4 · Change Intel">
                    <Q4ChangeIntelTab timeframe={timeframe} />
                  </Tab>
                  <Tab title="Q5 · Capacity & Growth">
                    <Q5CapacityTab timeframe={timeframe} />
                  </Tab>
                  <Tab title="Q6 · Security & Compliance">
                    <Q6SecurityTab timeframe={timeframe} />
                  </Tab>
                </Tabs>
              </div>
            </div>
          </Page.Main>
        </Page>
      </DTIntelligenceContext.Provider>
      </AIAssistContext.Provider>
      <CIOBriefModal open={cioBriefOpen} onClose={closeCioBrief} />
    </>
  );
}

export const App = () => (
  <SettingsProvider>
    <AppInner />
  </SettingsProvider>
);
