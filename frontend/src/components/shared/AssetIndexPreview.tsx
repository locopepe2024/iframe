'use client';

import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { API_URL, authenticatedFetch, type AssetReferenceIndexEntry } from '@/lib/api';

export type AssetPreviewRef = Pick<AssetReferenceIndexEntry,
  'source_scope' | 'source_container_id' | 'asset_type' | 'asset_id'> & { variant_id: string };

export function AssetIndexPreview({ asset, alt = '' }: { asset: AssetPreviewRef; alt?: string }) {
  const [previewUrl, setPreviewUrl] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const params = new URLSearchParams({
      scope: asset.source_scope === 'episode' ? 'project' : asset.source_scope,
      container_id: asset.source_container_id || '',
      asset_type: asset.asset_type,
      asset_id: asset.asset_id,
      variant_id: asset.variant_id,
    });
    setPreviewUrl(undefined);
    authenticatedFetch(`${API_URL}/asset-index/preview?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Asset preview unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => { if (!controller.signal.aborted) setPreviewUrl(undefined); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.source_scope, asset.source_container_id, asset.asset_type, asset.asset_id, asset.variant_id]);

  return previewUrl
    ? <img src={previewUrl} alt={alt} className="h-full w-full object-cover" />
    : <span className="flex h-full w-full items-center justify-center text-text-muted"><ImageIcon size={16} aria-hidden="true" /></span>;
}
