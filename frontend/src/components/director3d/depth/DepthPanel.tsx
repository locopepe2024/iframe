import { useEffect, useRef, useState } from 'react';
import { directorDepthApi, type DepthTask } from '@/lib/directorDepth';
import { captureDepthSnapshot } from '../state/depth-snapshot';

export function DepthPanel() {
  const [near, setNear] = useState(0.5);
  const [far, setFar] = useState(20);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState('正在检查深度服务…');
  const [task, setTask] = useState<DepthTask | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void Promise.all([directorDepthApi.capability(), directorDepthApi.list()]).then(([capability, tasks]) => {
      if (!mounted.current) return;
      setAvailable(capability.available);
      setMessage(capability.available ? '' : '深度渲染服务暂不可用，请联系管理员。');
      setTask(tasks[0] ?? null);
    }).catch(() => { if (mounted.current) setMessage('无法连接深度服务。'); });
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!task || !['queued', 'running'].includes(task.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await directorDepthApi.get(task.id); if (active) setTask(result); }
      catch { if (active) setMessage('读取任务进度失败，正在重试…'); }
      if (active) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [task?.id, task?.status]);
  useEffect(() => {
    setPreview('');
    if (task?.status !== 'completed') return;
    let active = true;
    let url = '';
    void directorDepthApi.blob(task.id, 'preview').then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob); setPreview(url);
    }).catch(() => { if (active) setMessage('深度预览加载失败。'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [task?.id, task?.status]);
  const submit = async () => {
    setSubmitting(true); setMessage('');
    try {
      const result = await directorDepthApi.submit(captureDepthSnapshot(near, far));
      if (mounted.current) setTask(result);
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : '提交失败。'); }
    finally { if (mounted.current) setSubmitting(false); }
  };
  const download = async (kind: 'meters' | 'manifest') => {
    if (!task) return;
    try {
      const blob = await directorDepthApi.blob(task.id, kind);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url;
      link.download = `depth-${task.id}.${kind === 'meters' ? 'exr' : 'json'}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setMessage('下载失败，请重试。'); }
  };
  const busy = submitting || task?.status === 'queued' || task?.status === 'running';
  return <section className="depth-panel" aria-label="场景深度">
    <h3>场景深度</h3>
    <p>提交当前帧和当前视图，生成实体场景的深度参考。</p>
    <div className="depth-range">
      <label>近端（米）<input type="number" min={0} max={9999} step={0.1} value={near} onChange={event => setNear(Number(event.target.value))}/></label>
      <label>远端（米）<input type="number" min={0.1} max={10000} step={0.1} value={far} onChange={event => setFar(Number(event.target.value))}/></label>
    </div>
    <button type="button" disabled={!available || busy || far <= near} onClick={() => void submit()}>{busy ? '深度生成中…' : '提交当前帧深度'}</button>
    {message && <p role="alert">{message}</p>}
    {task && <div aria-live="polite">
      <p>第 {task.frame} 帧 · {task.cameraLabel} · {{queued: '排队中', running: '渲染中', completed: '已完成', failed: '失败'}[task.status]}</p>
      {task.error && <p role="alert">{task.error}</p>}
      {preview && <><img className="depth-preview" src={preview} alt={`第 ${task.frame} 帧场景深度，近处黑，远处白`}/><p>黑 {task.nearM} 米 → 白 {task.farM} 米；空背景显示为白。</p></>}
      {task.status === 'completed' && <div className="depth-range"><button type="button" onClick={() => void download('meters')}>下载米制 EXR</button><button type="button" onClick={() => void download('manifest')}>下载深度记录</button></div>}
    </div>}
  </section>;
}
