'use client';

import { useRef, useState } from 'react';
import {
  ArrowRight, BookOpen, Camera, Check, ChevronRight, Code2, Crosshair,
  Layers3, Menu, ScanLine, ShieldCheck, Smartphone, Sparkles, Target, Timer, X,
} from 'lucide-react';
import { HOME_HASH } from '@/lib/appRoutes';
import PosePreview from './motion-home/PosePreview';
import MotionDemos from './motion-home/MotionDemos';
import styles from './motion-home/MotionHome.module.css';

const navigation = ['采集', 'API 文档', '测试台', '控制台'];

const capabilities = [
  { icon: Crosshair, title: '端侧动作捕捉', text: '使用 MediaPipe、Vision 或 ML Kit 实时捕捉人体关键点与关节角度，原始视频保留在设备上。' },
  { icon: Camera, title: '拍照评估体态', text: '一张站姿照片即可评估高低肩、圆肩和骨盆倾斜，无需集成 SDK。' },
  { icon: Sparkles, title: '多模态 AI 报告', text: '结合动作画面分析技术细节，标记高光片段，并给出针对性的纠错和训练建议。' },
];

const steps = [
  ['打开采集', '使用 Web、iOS 或 Android 开始。'],
  ['捕捉动作', '在设备上实时识别人体姿态。'],
  ['提交分析', '将结构化动作数据提交至 API。'],
  ['查看报告', '查看高光、技术问题和训练建议。'],
];

const plans = [
  { name: '基础版', price: 10, credits: 100 },
  { name: '标准版', price: 50, credits: 600, bonus: 100, featured: true },
  { name: '高级版', price: 100, credits: 1400, bonus: 400 },
];

const benefits = [
  { icon: Timer, title: '秒级响应', text: '提交动作 JSON 后，即可快速获取分析结果。' },
  { icon: ShieldCheck, title: '隐私优先', text: '端侧采集流程仅上传结构化动作数据。' },
  { icon: Code2, title: '开发友好', text: '提供 RESTful API、接口文档与 SDK。' },
  { icon: Target, title: '专业分析', text: '根据关节角度对比动作模型，定位技术问题。' },
  { icon: Layers3, title: '多场景支持', text: '覆盖羽毛球、健身、舞蹈等动作分析场景。' },
  { icon: Smartphone, title: '三端覆盖', text: '支持 Web、iOS 和 Android 动作采集。' },
];

const footerGroups = [
  { title: '产品', links: [['API 文档'], ['在线测试', '测试台'], ['控制台']] },
  { title: '支持', links: [['技术支持'], ['商务合作']] },
  { title: '法律', links: [['隐私政策'], ['服务条款']] },
];

function Brand({ onClick }: { onClick: () => void }) {
  return <a className={styles.brand} href={HOME_HASH} onClick={onClick} aria-label="iFrame 首页">iFrame</a>;
}

export default function MotionHome() {
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [feature, setFeature] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  function openFeature(name: string) {
    setFeature(name);
    dialog.current?.showModal();
  }

  function goHome() {
    setMenuOpen(false);
    root.current?.scrollIntoView({ block: 'start' });
  }

  return (
    <div className={styles.root} ref={root} lang="zh-CN">
      <header className={styles.siteHeader}>
        <div className={`${styles.wrap} ${styles.headerInner}`}>
          <Brand onClick={goHome} />
          <button
            className={styles.menuToggle}
            type="button"
            aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={menuOpen}
            aria-controls="motion-home-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div id="motion-home-menu" className={menuOpen ? `${styles.headerMenu} ${styles.isOpen}` : styles.headerMenu}>
            <nav aria-label="主导航">
              <a href={HOME_HASH} onClick={goHome} aria-current="page">首页</a>
              {navigation.map((name) => (
                <button key={name} type="button" onClick={() => openFeature(name)}>{name}</button>
              ))}
            </nav>
            <div className={styles.headerActions}>
              <button className={styles.appButton} type="button" onClick={() => openFeature('APP')}>
                <Smartphone size={16} /> APP
              </button>
              <button type="button" onClick={() => openFeature('登录')}>登录</button>
              <button className={`${styles.button} ${styles.primary} ${styles.small}`} type="button" onClick={() => openFeature('注册')}>
                免费注册 <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div>
        <section className={styles.hero}>
          <div className={`${styles.wrap} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}><span /> AI 动作分析平台</p>
              <h1>读懂动作，<br /><span>练得更好。</span></h1>
              <p className={styles.heroDescription}>让手机或电脑实时捕捉人体姿态，快速识别高光与技术问题，获取 AI 教练为你制定的训练建议。</p>
              <div className={styles.heroActions}>
                <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => openFeature('注册')}>
                  免费开始 <ArrowRight size={18} />
                </button>
                <button className={`${styles.button} ${styles.secondary}`} type="button" onClick={() => openFeature('API 文档')}>
                  <BookOpen size={17} /> 查看 API 文档
                </button>
              </div>
              <p className={styles.heroNote}><Check size={15} /> 注册赠送 50 积分，无需信用卡</p>
            </div>
            <PosePreview />
          </div>
        </section>

        <section className={`${styles.section} ${styles.capabilities}`} aria-labelledby="capabilities-title">
          <div className={styles.wrap}>
            <h2 id="capabilities-title">核心能力</h2>
            <p className={styles.sectionDescription}>从端侧姿态采集到云端分析，支持多种运动场景。</p>
            <div className={styles.cardGrid}>
              {capabilities.map(({ icon: Icon, title, text }) => (
                <article className={styles.card} key={title}>
                  <span className={styles.iconBox}><Icon size={23} /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <MotionDemos />

        <section className={`${styles.section} ${styles.workflow}`} aria-labelledby="workflow-title">
          <div className={styles.wrap}>
            <h2 id="workflow-title">四步完成动作分析</h2>
            <ol className={styles.steps}>
              {steps.map(([title, text], index) => (
                <li key={title}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={`${styles.section} ${styles.apiSection}`} aria-labelledby="api-title">
          <div className={`${styles.wrap} ${styles.apiGrid}`}>
            <div>
              <span className={styles.iconBox}><Code2 size={24} /></span>
              <h2 id="api-title">简洁的 REST API</h2>
              <p className={styles.sectionDescription}>提交端侧采集的动作数据，通过同一个接口获取高光片段、技术问题和 AI 教练报告。</p>
              <button className={styles.textButton} type="button" onClick={() => openFeature('API 文档')}>
                查看 API 文档 <ArrowRight size={17} />
              </button>
            </div>
            <div className={styles.codePanel}>
              <div className={styles.codeHeader}><Code2 size={17} /> 请求示例 <span>cURL</span></div>
              <pre tabIndex={0} aria-label="cURL 请求示例"><code><span>{'# 提交动作数据文件\n'}</span>{'curl -X POST \\\n  https://api.example.com/api/v1/motion/analyze \\\n  -H "X-API-Key: YOUR_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  --data @motion.json'}</code></pre>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.pricing}`} aria-labelledby="pricing-title">
          <div className={styles.wrap}>
            <h2 id="pricing-title">按需充值，灵活计费</h2>
            <p className={styles.sectionDescription}>按使用量扣除积分，无月费。</p>
            <div className={styles.cardGrid}>
              {plans.map(({ name, price, credits, bonus, featured }) => (
                <article className={`${styles.card} ${styles.priceCard}${featured ? ` ${styles.featured}` : ""}`} key={name}>
                  <h3>{name}</h3>
                  <p className={styles.price}><span>¥</span>{price}</p>
                  <p className={styles.credits}>{credits.toLocaleString('zh-CN')} 积分 {bonus && <span>含赠送 {bonus} 积分</span>}</p>
                  <ul>{['全部 API 权限', 'AI 分析报告', '高光集锦生成'].map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul>
                  <button className={`${styles.button} ${featured ? styles.primary : styles.secondary}`} type="button" onClick={() => openFeature('充值')}>
                    立即充值
                  </button>
                </article>
              ))}
            </div>
            <p className={styles.pricingNote}>视频分析费用按积分计算，每次基础消耗 20 积分，另按视频时长每秒扣除 0.5 积分。</p>
          </div>
        </section>

        <section className={`${styles.section} ${styles.benefits}`} aria-labelledby="benefits-title">
          <div className={styles.wrap}>
            <h2 id="benefits-title">为什么选择 iFrame</h2>
            <div className={styles.benefitsGrid}>
              {benefits.map(({ icon: Icon, title, text }) => (
              <article key={title}>
                <span className={styles.iconBox}><Icon size={20} /></span>
                <div><h3>{title}</h3><p>{text}</p></div>
              </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.wrap} ${styles.closing}`} aria-labelledby="closing-title">
          <div>
            <h2 id="closing-title">用 AI 分析你的下一次训练</h2>
            <p>注册即可领取 50 积分。</p>
          </div>
          <button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => openFeature('注册')}>
            免费开始 <ArrowRight size={18} />
          </button>
        </section>
      </div>

      <footer className={styles.siteFooter}>
        <div className={styles.wrap}>
          <div className={styles.footerGrid}>
            <div><Brand onClick={goHome} /><p>面向运动训练的 AI 动作分析平台。</p></div>
            {footerGroups.map(({ title, links }) => (
              <div className={styles.footerLinks} key={title}>
                <h2>{title}</h2>
                {links.map(([label, featureName = label]) => (
                  <button key={label} type="button" onClick={() => openFeature(featureName)}>{label}</button>
                ))}
              </div>
            ))}
          </div>
          <p className={styles.copyright}>© 2026 iFrame</p>
        </div>
      </footer>

      <dialog
        className={styles.dialog}
        ref={dialog}
        aria-labelledby="motion-home-dialog-title"
        aria-describedby="motion-home-dialog-description"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <form method="dialog" className={styles.dialogContent}>
          <button className={styles.dialogClose} type="submit" aria-label="关闭弹窗"><X size={20} /></button>
          <span className={styles.iconBox}><ScanLine size={23} /></span>
          <h2 id="motion-home-dialog-title">暂未开放</h2>
          <p id="motion-home-dialog-description">「{feature}」功能暂未开放。</p>
          <button className={`${styles.button} ${styles.primary}`} type="submit" autoFocus>知道了</button>
        </form>
      </dialog>
    </div>
  );
}
