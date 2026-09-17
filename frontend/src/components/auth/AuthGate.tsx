"use client";

import { Loader2, LogIn, Sparkles } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { useAuth } from "./AuthProvider";

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, login } = useAuth();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <main className="min-h-dvh grid place-items-center bg-background text-foreground">
        <div className="flex items-center gap-3 text-sm text-text-secondary" role="status">
          <Loader2 className="animate-spin" size={20} />
          正在确认登录状态…
        </div>
      </main>
    );
  }

  if (user) return children;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!loginName.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(loginName.trim(), password);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "登录失败，请检查账号和密码。";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-dvh bg-background text-foreground grid place-items-center px-5 py-10">
      <section className="glass-panel atelier-card w-full max-w-md rounded-[24px] border border-glass-border p-7 shadow-2xl">
        <div className="mb-7">
          <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-primary">
            <Sparkles size={22} aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">登录 iFrame</h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            使用 UniArt 账号登录。创作会话、历史素材和 API 配置将按个人账户隔离。
          </p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="lumenx-login-name" className="mb-2 block text-sm font-medium">账号</label>
            <input
              id="lumenx-login-name"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              autoComplete="username"
              className="glass-input min-h-11 w-full"
              placeholder="用户名或邮箱"
              required
            />
          </div>
          <div>
            <label htmlFor="lumenx-password" className="mb-2 block text-sm font-medium">密码</label>
            <input
              id="lumenx-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="glass-input min-h-11 w-full"
              required
            />
          </div>
          {error && (
            <p className="rounded-lg border border-status-failed-border bg-status-failed-bg px-3 py-2 text-sm text-status-failed-fg" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !loginName.trim() || !password}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitting ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />}
            {submitting ? "正在登录…" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
