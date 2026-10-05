'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { Brush, Eraser, Square, Trash2 } from 'lucide-react';

export type Point = { x: number; y: number };
export type Mark = { points: Point[]; width: number };
export type Marking = { strokes: Mark[]; rect: { x: number; y: number; width: number; height: number } | null };
export const emptyMarking = (): Marking => ({ strokes: [], rect: null });

export function drawMarking(ctx: CanvasRenderingContext2D, marking: Marking, width: number, height: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of marking.strokes) {
    if (!stroke.points.length) continue;
    ctx.lineWidth = stroke.width * Math.max(width, height);
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * width + 0.01, stroke.points[0].y * height);
    ctx.stroke();
  }
  if (marking.rect) {
    ctx.fillRect(marking.rect.x * width, marking.rect.y * height, marking.rect.width * width, marking.rect.height * height);
  }
}

export async function renderMarkedImage(source: string, marking: Marking, width: number, height: number, mask: boolean): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  if (mask) {
    // Opaque pixels preserve the source; transparent pixels select the edit region.
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Image unavailable')); image.src = source; });
    ctx.drawImage(image, 0, 0, width, height);
    ctx.strokeStyle = '#ff4d4f'; ctx.fillStyle = 'rgba(255,77,79,0.35)';
  }
  drawMarking(ctx, marking, width, height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Export failed')), 'image/png'));
}

export default function ImageMarkingCanvas({ source, marking, onChange, mode }: {
  source: string; marking: Marking; onChange: (next: Marking) => void; mode: 'annotate' | 'mask';
}) {
  const [tool, setTool] = useState<'brush' | 'erase' | 'rect'>('brush');
  const [size, setSize] = useState(32);
  const [draft, setDraft] = useState<Point[]>([]);
  const start = useRef<Point | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const point = (event: PointerEvent<HTMLDivElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const at = point(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'erase') {
      onChange({ ...marking, strokes: marking.strokes.filter(stroke => !stroke.points.some(p => Math.hypot(p.x - at.x, p.y - at.y) < size / Math.max(surface.current?.clientWidth || 1, surface.current?.clientHeight || 1))) });
      return;
    }
    start.current = at; setDraft([at]);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (tool === 'erase') {
      const at = point(event);
      onChange({ ...marking, strokes: marking.strokes.filter(stroke => !stroke.points.some(p => Math.hypot(p.x - at.x, p.y - at.y) < size / Math.max(surface.current?.clientWidth || 1, surface.current?.clientHeight || 1))) });
      return;
    }
    if (!start.current) return;
    setDraft(current => [...current, point(event)]);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!start.current || tool === 'erase') return;
    const last = point(event);
    if (tool === 'rect') {
      const x = Math.min(start.current.x, last.x), y = Math.min(start.current.y, last.y);
      if (Math.abs(last.x - start.current.x) > 0.002 && Math.abs(last.y - start.current.y) > 0.002) {
        onChange({ ...marking, rect: { x, y, width: Math.abs(last.x - start.current.x), height: Math.abs(last.y - start.current.y) } });
      }
    } else {
      onChange({ ...marking, strokes: [...marking.strokes, { points: [...draft, last], width: size / Math.max(surface.current?.clientWidth || 1, surface.current?.clientHeight || 1) }] });
    }
    start.current = null; setDraft([]);
  };
  const shapes = [...marking.strokes, ...(tool === 'brush' && draft.length ? [{ points: draft, width: size / Math.max(surface.current?.clientWidth || 1, surface.current?.clientHeight || 1) }] : [])];
  const rectDraft = tool === 'rect' && start.current && draft.length ? {
    x: Math.min(start.current.x, draft.at(-1)!.x), y: Math.min(start.current.y, draft.at(-1)!.y),
    width: Math.abs(draft.at(-1)!.x - start.current.x), height: Math.abs(draft.at(-1)!.y - start.current.y),
  } : null;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-glass-border bg-surface p-2">
      <button type="button" aria-label="画笔" aria-pressed={tool === 'brush'} onClick={() => setTool('brush')} className="rounded p-2 aria-pressed:bg-hover-bg"><Brush size={17}/></button>
      <button type="button" aria-label="橡皮擦" aria-pressed={tool === 'erase'} onClick={() => setTool('erase')} className="rounded p-2 aria-pressed:bg-hover-bg"><Eraser size={17}/></button>
      <button type="button" aria-label="矩形" aria-pressed={tool === 'rect'} onClick={() => setTool('rect')} className="rounded p-2 aria-pressed:bg-hover-bg"><Square size={17}/></button>
      <label className="flex items-center gap-2 text-xs">{size}px <input aria-label="画笔大小" type="range" min="8" max="160" value={size} onChange={event => setSize(Number(event.target.value))}/></label>
      <button type="button" aria-label="清除标记" title="清除标记" disabled={!marking.strokes.length && !marking.rect} onClick={() => onChange(emptyMarking())} className="rounded p-2 disabled:opacity-40"><Trash2 size={17}/></button>
    </div>
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-3">
      <div ref={surface} className="relative inline-block max-h-full max-w-full touch-none select-none" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { start.current = null; setDraft([]); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source} alt={mode === 'mask' ? '蒙板原图' : '标注原图'} draggable={false} className="block max-h-[65vh] max-w-full object-contain"/>
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={mode === 'mask' ? '蒙板画布' : '标注画布'} className="pointer-events-none absolute inset-0 h-full w-full" style={{ overflow: 'visible' }}>
          {shapes.map((stroke, i) => stroke.points.length === 1 || stroke.points.every(p => p.x === stroke.points[0].x && p.y === stroke.points[0].y)
            ? <circle key={i} cx={stroke.points[0].x} cy={stroke.points[0].y} r={stroke.width / 2} fill={mode === 'mask' ? '#22c55e' : '#ff4d4f'} fillOpacity="0.75"/>
            : <polyline key={i} points={stroke.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={mode === 'mask' ? '#22c55e' : '#ff4d4f'} strokeOpacity="0.75" strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round"/>)}
          {marking.rect && <rect x={marking.rect.x} y={marking.rect.y} width={marking.rect.width} height={marking.rect.height} fill={mode === 'mask' ? '#22c55e' : '#ff4d4f'} fillOpacity="0.35"/>}
          {rectDraft && <rect x={rectDraft.x} y={rectDraft.y} width={rectDraft.width} height={rectDraft.height} fill={mode === 'mask' ? '#22c55e' : '#ff4d4f'} fillOpacity="0.2" stroke={mode === 'mask' ? '#22c55e' : '#ff4d4f'} strokeWidth="0.003"/>}
        </svg>
      </div>
    </div>
  </div>;
}
