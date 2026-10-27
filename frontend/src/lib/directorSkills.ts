import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "./api";

export type CreativeStage = "series" | "episode" | "shooting_plan" | "storyboard";
export interface CreativeSkillSelection { id: string; revision: string }
export interface CreativeSkillTask extends CreativeSkillSelection {
    label: string; category: string; description: string; version: string;
    source: string; source_revision: string;
}
export function useDirectorSkills(scopeId: string | undefined, stage: CreativeStage) {
    const [catalog, setCatalog] = useState<CreativeSkillTask[]>([]);
    const [selected, setSelected] = useState<CreativeSkillSelection[]>([]);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [reload, setReload] = useState(0);
    const requestId = useRef(0);
    const endpoint = scopeId ? stage === "series"
        ? `${API_URL}/series/${encodeURIComponent(scopeId)}/director-skills`
        : `${API_URL}/projects/${encodeURIComponent(scopeId)}/director-skills/${stage}` : "";
    useEffect(() => {
        const id = ++requestId.current;
        setSelected([]); setCatalog([]); setError(""); setLoading(true); setSaving(false);
        if (!endpoint) return;
        void axios.get<{ catalog: CreativeSkillTask[]; skills: CreativeSkillSelection[] }>(endpoint, { timeout: 15000 })
            .then(({ data }) => {
                if (id !== requestId.current) return;
                if (!Array.isArray(data.catalog) || !Array.isArray(data.skills)) throw new Error("目录响应无效");
                setCatalog(data.catalog); setSelected(data.skills);
            }).catch(() => { if (id === requestId.current) setError("创作 Skills 加载失败，请重试"); })
            .finally(() => { if (id === requestId.current) setLoading(false); });
        return () => { ++requestId.current; };
    }, [endpoint, reload]);
    const update = async (next: CreativeSkillSelection[]) => {
        const id = requestId.current;
        setSaving(true); setError("");
        try {
            await axios.put(endpoint, { skills: next }, { timeout: 15000 });
            if (id === requestId.current) setSelected(next);
        } catch { if (id === requestId.current) setError("选择保存失败，请重试；尚未更改本次选择"); }
        finally { if (id === requestId.current) setSaving(false); }
    };
    const canRun = !loading && !saving && !error && selected.every(s => catalog.some(t => t.id === s.id && t.revision === s.revision));
    return { catalog, selected, loading, saving, error, canRun, update, retry: () => setReload(n => n + 1) };
}
