"use client";

import { useEffect, useState } from 'react';
import { playgroundApi } from '@/lib/api';

const DEFAULT_MODEL = 'Qwen3.8-27B-Uncensored-Q8_0';

export default function PolishModelSelect({ value, onChange }: {
    value: string;
    onChange: (model: string) => void;
}) {
    const [models, setModels] = useState<{ id: string; name: string }[]>([]);
    const [error, setError] = useState(false);

    useEffect(() => {
        let active = true;
        playgroundApi.getUniArtModels().then(({ models: catalog }) => {
            if (!active) return;
            setModels(catalog.filter(model => model.capabilities.includes('chat')).map(model => ({
                id: model.api_model_id,
                name: model.display_name || model.api_model_id,
            })));
            setError(false);
        }).catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (models.length && !models.some(model => model.id === value)) {
            onChange(models[0].id);
        }
    }, [models, value, onChange]);

    const selected = value || DEFAULT_MODEL;
    const available = models.some(model => model.id === selected);
    return (
        <>
            <select value={selected} onChange={event => onChange(event.target.value)}
                className="w-full bg-surface border border-glass-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50">
                {!available && <option value={selected}>{selected}{value ? ' · 当前网关未提供' : ' · 默认模型'}</option>}
                {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
            {error && <p className="text-xs text-red-400">暂时无法获取网关模型列表，请稍后重试。</p>}
        </>
    );
}
