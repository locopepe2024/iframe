import { useEffect, useRef } from 'react';
import styles from './MotionHome.module.css';

const joints: Array<[number, number]> = [
  [276, 66], [263, 104], [232, 111], [284, 118], [195, 137], [319, 154],
  [156, 117], [347, 122], [237, 176], [266, 184], [180, 210], [317, 222],
  [143, 264], [365, 268], [115, 267], [393, 273],
];

const bones = [
  [0, 1], [1, 2], [1, 3], [2, 3], [2, 4], [4, 6], [3, 5], [5, 7],
  [2, 8], [3, 9], [8, 9], [8, 10], [10, 12], [12, 14], [9, 11], [11, 13], [13, 15],
];

export default function PosePreview() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(element.clientWidth * ratio);
      element.height = Math.round(element.clientHeight * ratio);
      const scale = Math.min(element.width / 500, element.height / 320);
      ctx.setTransform(scale, 0, 0, scale, (element.width - 500 * scale) / 2, (element.height - 320 * scale) / 2);
      ctx.lineCap = 'round';

      const line = (x1: number, y1: number, x2: number, y2: number) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(167, 149, 255, .16)';
      for (let x = -110; x < 630; x += 48) line(250 + (x - 250) * .38, 226, x, 320);
      for (const y of [230, 243, 261, 286, 319]) line(0, y, 500, y);

      ctx.strokeStyle = 'rgba(163, 137, 255, .50)';
      ctx.setLineDash([4, 6]);
      ctx.strokeRect(103, 39, 309, 244);
      ctx.setLineDash([]);

      ctx.strokeStyle = '#a992ff';
      ctx.lineWidth = 2;
      for (const [x, y, dx, dy] of [[103, 39, 1, 1], [412, 39, -1, 1], [103, 283, 1, -1], [412, 283, -1, -1]]) {
        line(x, y, x + 13 * dx, y);
        line(x, y, x, y + 13 * dy);
      }

      const color = ctx.createLinearGradient(160, 60, 346, 260);
      color.addColorStop(0, '#d5c0ff');
      color.addColorStop(.55, '#a58aff');
      color.addColorStop(1, '#68e5ed');
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.shadowColor = '#a280ff';
      ctx.shadowBlur = 14 * scale;
      for (const [start, end] of bones) line(...joints[start], ...joints[end]);

      for (const [index, [x, y]] of joints.entries()) {
        ctx.beginPath();
        ctx.arc(x, y, index === 0 ? 15 : 5, 0, 2 * Math.PI);
        ctx.fillStyle = index === 0 ? '#2b2155' : '#e4e0ff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = '#68e5ed';
      ctx.lineWidth = 1;
      line(322, 222, 397, 205);
      ctx.setLineDash([]);
      ctx.fillStyle = '#aaeff6';
      ctx.font = '12px monospace';
      ctx.fillText('134°', 397, 202);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(element);
    draw();
    return () => observer.disconnect();
  }, []);

  return (
    <figure className={styles.preview} aria-label="动作捕捉示意，展示一组人体关节连线与膝关节角度">
      <figcaption className={styles.previewBar}>
        <span>姿态捕捉示意</span>
        <span className={styles.previewIndicator}><span /> POSE TRACKING</span>
      </figcaption>
      <div className={styles.poseStage}><canvas ref={canvas} aria-hidden="true" /></div>
      <div className={styles.previewMetrics}>
        <div><span>动作数据</span><strong>关键点</strong></div>
        <div><span>膝关节角度</span><strong>134°</strong></div>
        <div><span>推理位置</span><strong>设备端</strong></div>
      </div>
    </figure>
  );
}
