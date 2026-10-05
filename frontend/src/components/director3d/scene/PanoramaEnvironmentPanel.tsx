import { useCallback, useEffect, useState } from 'react';
import { FileJson, LockKeyhole, RefreshCw, UnlockKeyhole, X } from 'lucide-react';

import { panoramaAssetApi } from '@/lib/panoramaAssets';
import { downloadMotionJson } from '../state/motion-review-export';
import { useWorkbenchStore } from '../state/workbench-store';
import type { EnvironmentInputEntry } from '../types';

export function admittedPanoramaEntries(records: Awaited<ReturnType<typeof panoramaAssetApi.list>>): EnvironmentInputEntry[] {
  return records.filter(record => record.projection_type === 'equirectangular'
    && record.panorama_quality?.status === 'pass'
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
  const scenePackage = useWorkbenchStore(state => state.panoramaScenePackage);
  const applyScenePackage = useWorkbenchStore(state => state.applyPanoramaScenePackage);
  const createManualLayout = useWorkbenchStore(state => state.createManualPanoramaLayout);
  const addAnchor = useWorkbenchStore(state => state.addPanoramaAnchor);
  const updateAnchor = useWorkbenchStore(state => state.updatePanoramaAnchorPosition);
  const removeAnchor = useWorkbenchStore(state => state.removePanoramaAnchor);
  const ground = useWorkbenchStore(state => state.renderScene.ground);
  const setGroundHeight = useWorkbenchStore(state => state.setGroundHeightM);
  const toggleGroundLocked = useWorkbenchStore(state => state.toggleGroundLocked);
  const assign = useWorkbenchStore(state => state.assignPanoramaInput);
  const setYaw = useWorkbenchStore(state => state.setPanoramaRotationAxis);
  const confirm = useWorkbenchStore(state => state.confirmPanoramaCalibration);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [packageMessage, setPackageMessage] = useState('');
  const [anchorKind, setAnchorKind] = useState('entrance');
  const [anchorPosition, setAnchorPosition] = useState<[number, number, number]>([0, 2, 0]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const records = [] as Awaited<ReturnType<typeof panoramaAssetApi.list>>;
      let page: Awaited<ReturnType<typeof panoramaAssetApi.list>>;
      do {
        page = await panoramaAssetApi.list(100, records.length);
        records.push(...page);
      } while (page.length === 100);
      const entries = admittedPanoramaEntries(records);
      setCatalog({ status: 'ready', message: entries.length ? `已读取 ${entries.length} 张全景素材` : '没有已保存且通过检查的全景素材。', entries });
      setSelectedAssetId(current => entries.some(entry => entry.inputId === current) ? current : '');
    } catch {
      setCatalog({ status: 'error', message: '全景素材读取失败，请重试。', entries: [] });
    } finally { setRefreshing(false); }
  }, [setCatalog]);
  useEffect(() => { void refresh(); }, [refresh]);
  const importScenePackage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const result = applyScenePackage(JSON.parse(await file.text()));
      setPackageMessage(result.ok ? '场景包已绑定，等待导演审核。' : result.errors.join(' '));
    } catch {
      setPackageMessage('场景包不是有效 JSON。');
    }
  };
  return <section className="panorama-environment-panel" aria-label="全景环境">
    <div className="panorama-panel-heading"><strong>全景环境</strong><button type="button" title="刷新全景素材" aria-label="刷新全景素材" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={16}/></button></div>
    <select aria-label="选择全景素材" value={selectedAssetId} onChange={event => setSelectedAssetId(event.target.value)} disabled={catalog.status === 'error'}>
      <option value="">选择已保存的全景素材</option>
      {catalog.entries.map(entry => <option key={entry.inputId} value={entry.inputId}>{entry.label}</option>)}
    </select>
    <button type="button" disabled={!selectedAssetId || selectedAssetId === panorama.inputId || catalog.status !== 'ready'} onClick={() => assign(selectedAssetId)}>导入全景素材</button>
    {panorama.inputId && <div className="panorama-controls">
      <label>方向 <input type="range" min={-180} max={180} value={panorama.rotationDeg[2]} onChange={event => setYaw(2, Number(event.target.value))}/><output>{Math.round(panorama.rotationDeg[2])}°</output></label>
      <button type="button" disabled={!activeCalibrationId} onClick={() => activeCalibrationId && confirm(activeCalibrationId)}>确认方向</button>
      <button type="button" title="移除全景" aria-label="移除全景" onClick={() => assign(null)}><X size={16}/></button>
    </div>}
    <div className="panorama-scene-package-actions">
      <button type="button" disabled={!panorama.inputId} onClick={() => { if (createManualLayout()) setPackageMessage('人工空间草稿已创建。'); }}>创建空间草稿</button>
      <label className="director-file-button" title="导入全景场景包">
        <FileJson size={15} /> 导入场景包
        <input type="file" accept="application/json,.json" onChange={(event) => void importScenePackage(event)} />
      </label>
      {scenePackage && <button type="button" onClick={() => downloadMotionJson('director-panorama-scene-package.v1.json', scenePackage)}>导出场景包</button>}
      <span className="panorama-scene-package-status" role="status">{scenePackage ? `${scenePackage.depth ? '深度草稿' : '人工布局，深度未验证'} · ${scenePackage.semanticAnchors.length} 个锚点` : '未建立空间布局'}</span>
      {packageMessage && <span className="panorama-scene-package-status" role="alert">{packageMessage}</span>}
    </div>
    {scenePackage && <div className="panorama-layout-editor">
      <div className="panorama-layout-ground"><label>地面高度（m）<input key={ground.heightM} type="number" min={-10} max={10} step="0.1" defaultValue={ground.heightM} disabled={ground.locked} onBlur={event => { if (event.target.value.trim()) setGroundHeight(Number(event.target.value)); }}/></label><button type="button" title={ground.locked ? '解锁地面' : '锁定地面'} aria-label={ground.locked ? '解锁地面' : '锁定地面'} onClick={toggleGroundLocked}>{ground.locked ? <LockKeyhole size={14}/> : <UnlockKeyhole size={14}/>}</button></div>
      <div className="panorama-layout-anchor-entry">
        <select aria-label="锚点类型" value={anchorKind} onChange={event => setAnchorKind(event.target.value)}><option value="entrance">入口</option><option value="wall">墙体</option><option value="prop">道具</option><option value="walkable">可行走区域</option><option value="subject_hint">人物位置</option></select>
        {(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>{axis}<input type="number" step="0.1" value={anchorPosition[index]} onChange={event => setAnchorPosition(current => current.map((value, i) => i === index ? Number(event.target.value) : value) as [number, number, number])}/></label>)}
        <button type="button" onClick={() => addAnchor(anchorKind, anchorPosition)}>添加锚点</button>
      </div>
      {scenePackage.semanticAnchors.map(anchor => <div className="panorama-layout-anchor" key={anchor.anchorId}>
        <strong>{anchor.kind}</strong>
        {(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis}>{axis}<input key={`${anchor.anchorId}-${index}-${anchor.positionM[index]}`} type="number" step="0.1" defaultValue={anchor.positionM[index]} onBlur={event => { const value = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(value)) updateAnchor(anchor.anchorId, anchor.positionM.map((current, i) => i === index ? value : current) as [number, number, number]); }}/></label>)}
        <button type="button" title={`删除${anchor.kind}锚点`} aria-label={`删除${anchor.kind}锚点`} onClick={() => removeAnchor(anchor.anchorId)}><X size={14}/></button>
      </div>)}
    </div>}
    <p role="status">{catalog.status === 'error' ? catalog.message : panorama.inputId ? preview.message : catalog.message || (catalog.entries.length ? `${catalog.entries.length} 个已声明全景可用` : '没有通过质量检查的全景；请在图片编辑中修复接缝、天顶和地面后保存。')}</p>
  </section>;
}
