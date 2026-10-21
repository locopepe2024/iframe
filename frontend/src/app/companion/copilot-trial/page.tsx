"use client";

import dynamic from "next/dynamic";

const CopilotTrial = dynamic(() => import("@/components/companion/copilot-trial/CopilotTrial"), {
  ssr: false,
  loading: () => <p style={{ padding: 24, fontSize: 20 }}>正在准备陪伴交互试验…</p>,
});

export default function CopilotTrialPage() {
  return <CopilotTrial />;
}
