"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { OptimizerProvider } from "./OptimizerSelector";

type Config = Awaited<ReturnType<typeof api.getPolishOptimizers>>;

/** Keep catalog choices scoped to this authenticated surface; never cache across accounts. */
export function useOptimizerProvider() {
    const [config, setConfig] = useState<Config | null>(null);
    const [provider, setProvider] = useState<OptimizerProvider>("local_llm");
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        setConfig(null);
        setError("");
        api.getPolishOptimizers().then((next) => {
            if (!active) return;
            setConfig(next);
            setProvider(next.default_provider);
        }).catch(() => {
            if (active) setError("无法加载当前账户的优化器，请重试。");
        });
        return () => { active = false; };
    }, [attempt]);
    const retry = useCallback(() => setAttempt((value) => value + 1), []);
    return { provider, setProvider, ready: !!config && !error,
        selectorProps: { options: config?.providers ?? [], loading: !config && !error, error, onRetry: retry } };
}
