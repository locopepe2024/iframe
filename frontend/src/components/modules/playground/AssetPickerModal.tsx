'use client';

import { useMemo, type RefObject } from 'react';
import ReferenceMaterialBrowser from '@/components/shared/ReferenceMaterialBrowser';
import { usePlaygroundStore } from './usePlaygroundStore';

export default function AssetPickerModal({ isOpen, onClose, onSelect, accept }: {
    isOpen: boolean; onClose: () => void; onSelect: (path: string) => void;
    accept: 'image' | 'video' | 'all'; triggerRef?: RefObject<HTMLElement>;
}) {
    const recentCandidates = useMemo(() => {
        const state = usePlaygroundStore.getState();
        return state.inputMedia.map(path => ({ path, label: state.mediaNames[path] || path.split('/').pop() || '当前素材', sourceLabel: '当前创作',
            type: (/\.(mp4|webm|mov)(?:[?#]|$)/i.test(path) ? 'video' : /\.(mp3|wav|m4a|ogg)(?:[?#]|$)/i.test(path) ? 'audio' : /\.(txt|md|json|csv|srt|vtt)(?:[?#]|$)/i.test(path) ? 'text' : 'image') as 'image' | 'video' | 'audio' | 'text' }));
    }, [isOpen]);
    return <ReferenceMaterialBrowser recentCandidates={recentCandidates} open={isOpen} onClose={onClose} accept={accept} allowRecentPaths
        onSelect={material => {
            usePlaygroundStore.getState().rememberMediaName(material.path, material.label);
            onSelect(material.path);
        }} />;
}
