"use client";

import { useState } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { TrialAgent } from "./agent";
import { TrialScenario } from "./scenario";
import { TrialContent } from "./TrialContent";

export function createTrial() {
  const scenario = new TrialScenario();
  const agent = new TrialAgent(scenario);
  return { scenario, agent, agents: { default: agent } };
}

export default function CopilotTrial({ trial: supplied }: { trial?: ReturnType<typeof createTrial> }) {
  const [trial] = useState(() => supplied ?? createTrial());
  return <CopilotKitProvider
    agents__unsafe_dev_only={trial.agents}
    agentId="default"
    enableInspector={false}
    showIntelligenceIndicator={false}
    learning={false}
    debug={false}
  >
    <TrialContent scenario={trial.scenario} />
  </CopilotKitProvider>;
}
