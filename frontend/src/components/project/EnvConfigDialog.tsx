"use client";

import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Loader2, Save, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

interface EnvConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isRequired?: boolean;
}

export default function EnvConfigDialog({ isOpen, onClose, isRequired = false }: EnvConfigDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://uniart.fun/v1");
  const [configured, setConfigured] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    api.getUserConfig()
      .then((config) => {
        setConfigured(Boolean(config.secrets_configured?.UNIART_API_KEY));
        setPrefix(config.secret_prefixes?.UNIART_API_KEY || "");
        setBaseUrl(config.UNIART_BASE_URL || "https://uniart.fun/v1");
        setApiKey("");
      })
      .catch(() => setError("无法读取当前用户配置，请重新登录后再试。"))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const save = async () => {
    if (!configured && !apiKey.trim()) {
      setError("请输入您自己的 UniArt API Key。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await api.saveUserConfig({
        ...(apiKey.trim() ? { UNIART_API_KEY: apiKey.trim() } : {}),
        UNIART_BASE_URL: baseUrl.trim(),
      });
      setConfigured(Boolean(next.secrets_configured?.UNIART_API_KEY));
      setPrefix(next.secret_prefixes?.UNIART_API_KEY || "");
      setApiKey("");
      onClose();
    } catch {
      setError("保存失败。请检查 API Key 和服务地址后重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center bg-overlay px-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => { if (!isRequired || configured) onClose(); }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-uniart-config-title"
            className="glass-panel atelier-card w-full max-w-lg rounded-[22px] border border-glass-border p-6 shadow-2xl"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
                  <KeyRound size={20} aria-hidden="true" />
                </div>
                <h2 id="user-uniart-config-title" className="font-display text-xl font-semibold">个人 UniArt 配置</h2>
                <p className="mt-1 text-sm leading-6 text-text-secondary">
                  密钥按当前登录账户加密保存，不与其他 LumenX 用户共享。
                </p>
              </div>
              {(!isRequired || configured) && (
                <button onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-hover-bg" aria-label="关闭">
                  <X size={19} />
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-text-secondary" role="status">
                <Loader2 className="animate-spin" size={18} /> 正在读取配置…
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <div>
                  <label htmlFor="user-uniart-key" className="mb-2 block text-sm font-medium">UniArt API Key</label>
                  <input
                    id="user-uniart-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="off"
                    className="glass-input min-h-11 w-full"
                    placeholder={configured ? `已配置 ${prefix || "个人密钥"}；留空保持不变` : "ur-... 或 sk-..."}
                  />
                  <p className="mt-2 text-xs text-text-muted">保存后不会再次显示完整密钥。</p>
                </div>
                <div>
                  <label htmlFor="user-uniart-url" className="mb-2 block text-sm font-medium">UniArt API 地址</label>
                  <input
                    id="user-uniart-url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    className="glass-input min-h-11 w-full"
                    inputMode="url"
                  />
                </div>
                {error && <p role="alert" className="rounded-lg border border-status-failed-border bg-status-failed-bg px-3 py-2 text-sm text-status-failed-fg">{error}</p>}
                <button
                  onClick={save}
                  disabled={saving || !baseUrl.trim()}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  {saving ? "正在保存…" : "保存个人配置"}
                </button>
              </div>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
