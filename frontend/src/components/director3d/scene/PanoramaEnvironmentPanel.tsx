import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

import { imageEditorApi } from '@/lib/imageEditor';
import { useWorkbenchStore } from '../state/workbench-store';
import type { EnvironmentInputEntry } from '../types';

export function admittedPanoramaEntries(records: Awaited<ReturnType<typeof imageEditorApi.list>>): EnvironmentInputEntry[] {
  return records.filter(record => record.projection_type === 'equirectangular'
    && record.width === record.height * 2 && record.height > 0
    && /^\/playground\/input-media\/[^/]+$/.test(record.path)
    && /^[a-f0-9]{64}$/.test(record.sha256)).map(record => ({
      inputId: record.path,
      checksum: record.sha256,
      admissionChecksum: record.sha256,
      label: record.title,
      mediaKind: 'image',
      usage: 'panorama',
      mimeType: record.path.endsWith('.jpg') ? 'image/jpeg' : record.path.endsWith('.webp') ? 'image/webp' : 'image/png',
      width: record.width,
      height: record.height,
      durationSeconds: null,
      projection: 'equirectangular',
      workflowState: 'user_declared',
      environmentAllowed: true,
      blockingCodes: [],
      depthSampleGrid: null,
    }));
}

export function PanoramaEnvironmentPanel() {
  const catalog = useWorkbenchStore(state => state.environmentInputCatalog);
  const panorama = useWorkbenchStore(state => state.renderScene.panorama);
  const activeCalibrationId = useWorkbenchStore(state => state.renderScene.activePanoramaCalibrationId);
  const preview = useWorkbenchStore(state => state.panoramaPreviewStatus);
  const setCatalog = useWorkbenchStore(state => state.setEnvironmentInputCatalog);
  const assign = useWorkbenchStore(state => state.assignPanoramaInput);
  const setYaw = useWorkbenchStore(state => state.setPanoramaRotationAxis);
  const confirm = useWorkbenchStore(state => state.confirmPanoramaCalibration);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const records = await imageEditorApi.list();
      setCatalog({ status: 'ready', message: '已读取图片编辑副本', entries: admittedPanoramaEntries(records) });
    } catch {
      setCatalog({ status: 'error', message: '全景素材读取失败，请重试。', entries: [] });
    } finally { setRefreshing(false); }
  }, [setCatalog]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <section className="panorama-environment-panel" aria-label="全景环境">
    <div className="panorama-panel-heading"><strong>全景环境</strong><button type="button" title="刷新全景素材" aria-label="刷新全景素材" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={16}/></button></div>
    <select aria-label="选择全景素材" value={panorama.inputId ?? ''} onChange={event => assign(event.target.value || null)} disabled={catalog.status === 'error'}>
      <option value="">无全景环境</option>
      {catalog.entries.map(entry => <option key={entry.inputId} value={entry.inputId}>{entry.label}</option>)}
    </select>
    {panorama.inputId && <div className="panorama-controls">
      <label>方向 <input type="range" min={-180} max={180} value={panorama.rotationDeg[2]} onChange={event => setYaw(2, Number(event.target.value))}/><output>{Math.round(panorama.rotationDeg[2])}°</output></label>
      <button type="button" disabled={!activeCalibrationId} onClick={() => activeCalibrationId && confirm(activeCalibrationId)}>确认方向</button>
      <button type="button" title="移除全景" aria-label="移除全景" onClick={() => assign(null)}><X size={16}/></button>
    </div>}
    <p role="status">{catalog.status === 'error' ? catalog.message : panorama.inputId ? preview.message : catalog.entries.length ? `${catalog.entries.length} 个已声明全景可用` : '没有已声明的 2:1 全景；请在图片编辑中保存。'}</p>
  </section>;
}
