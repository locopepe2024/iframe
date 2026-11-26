import Image from 'next/image';
import workflowImage from './workflow.jpg';
import styles from './MotionHome.module.css';

// Next supplies the configured base path for public assets at build time.
const basePath = process.env.__NEXT_ROUTER_BASEPATH || '';

const demos = [
  { title: '演示视频 1', filename: 'output_11_25' },
  { title: '演示视频 2', filename: 'output_11_26' },
];

export default function MotionDemos() {
  return (
    <section className={`${styles.section} ${styles.motionDemos}`} aria-labelledby="motion-demos-title">
      <div className={styles.wrap}>
        <h2 id="motion-demos-title">动捕与场景重建</h2>
        <div className={styles.demoGrid}>
          {demos.map(({ title, filename }) => (
            <video className={styles.demoVideo} key={filename} controls playsInline preload="metadata" aria-label={title}>
              <source src={`${basePath}/motion/${filename}-web.mp4`} type="video/mp4" />
            </video>
          ))}
        </div>

        <figure className={styles.workflowFigure}>
          <figcaption>
            <h3>制作流程</h3>
            <p>从输入视频中提取人物动作并重定向到粗模，同时拼接多帧背景、生成白模参考图，再据此重建 3D 场景。将角色与场景对齐后，可在网页预览或导出到 Blender 继续编辑。</p>
          </figcaption>
          <Image
            src={workflowImage}
            alt="八步制作流程：输入视频、检测人物与提取动画、动作重定向到粗模、多帧拼接场景、生成白模参考图、生成 3D 场景、对齐合并人物与场景、输出可编辑的 3D 动画场景。"
            sizes="(max-width: 634px) calc(100vw - 34px), (max-width: 850px) 600px, (max-width: 1208px) calc(100vw - 48px), 1160px"
          />
        </figure>
      </div>
    </section>
  );
}
