import type { AssetReferenceIndexEntry } from '@/lib/api';

export type AssetSearchType = 'all' | AssetReferenceIndexEntry['asset_type'];
export type AssetSearchScope = 'all' | AssetReferenceIndexEntry['source_scope'];

export interface StructuredAssetSearchOptions {
  query?: string;
  type?: AssetSearchType;
  scope?: AssetSearchScope;
}

/** Search the normalized asset index without resolving or attaching media.
 *  The result is still the durable asset identity; thumbnails remain a view.
 */
export function searchStructuredAssets(
  entries: AssetReferenceIndexEntry[] | undefined,
  options: StructuredAssetSearchOptions = {},
): AssetReferenceIndexEntry[] {
  const query = (options.query ?? '').trim().toLocaleLowerCase();
  return (entries ?? []).filter((entry) => {
    if (options.type && options.type !== 'all' && entry.asset_type !== options.type) return false;
    if (options.scope && options.scope !== 'all' && entry.source_scope !== options.scope) return false;
    if (!query) return true;
    return [entry.name, entry.description, entry.source_name, entry.source_scope, entry.asset_type]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(query);
  });
}
