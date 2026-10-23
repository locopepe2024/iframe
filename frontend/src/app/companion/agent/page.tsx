"use client";
import dynamic from "next/dynamic";
const AgentChat = dynamic(() => import("@/components/companion/agent/AgentChat"), { ssr: false, loading: () => <p style={{ padding: 24, fontSize: 20 }}>正在打开陪伴聊天…</p> });
export default function AgentPage() { return <AgentChat />; }
