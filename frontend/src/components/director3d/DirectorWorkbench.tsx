"use client";

import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";

import { App } from "./App";
import { restoreLocalDirectorDraft } from "./state/local-draft";
import { installBrowserViewStatePersistence, restoreBrowserViewState } from "./state/view-state-persistence";

class DirectorErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("3D director failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="director3d-fallback" role="alert">
        <h1>3D 导演台无法启动</h1>
        <p>当前浏览器未能初始化三维舞台。请确认 WebGL 可用后刷新页面。</p>
        <details><summary>错误详情</summary><pre>{this.state.error.message}</pre></details>
      </section>
    );
  }
}

export default function DirectorWorkbench() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    restoreLocalDirectorDraft();
    restoreBrowserViewState();
    const uninstall = installBrowserViewStatePersistence();
    setReady(true);
    return uninstall;
  }, []);

  return (
    <div className="director3d-root">
      <DirectorErrorBoundary>
        {ready ? <App /> : <div className="director3d-loading" role="status">正在准备三维舞台…</div>}
      </DirectorErrorBoundary>
    </div>
  );
}
