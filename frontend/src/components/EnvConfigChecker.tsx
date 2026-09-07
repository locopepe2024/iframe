"use client";

import { useState, useEffect } from "react";
import EnvConfigDialog from "@/components/project/EnvConfigDialog";
import { api } from "@/lib/api";
import { refreshUniArtModelCatalog } from "@/lib/modelCatalog";

export default function EnvConfigChecker() {
  const [isEnvDialogOpen, setIsEnvDialogOpen] = useState(false);
  const [envRequired, setEnvRequired] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    // 只在客户端执行，且只检查一次
    if (typeof window === 'undefined' || hasChecked) return;
    
    checkEnvConfig();
    refreshUniArtModelCatalog().then((count) => {
      if (count > 0 && !sessionStorage.getItem("lumenx_uniart_catalog_reloaded")) {
        sessionStorage.setItem("lumenx_uniart_catalog_reloaded", "1");
        window.location.reload();
      }
    });
    setHasChecked(true);
  }, [hasChecked]);

  const checkEnvConfig = async () => {
    try {
      const config = await api.getEnvConfig();
      // 空值和空字符串都视为未配置
      const dashscopeKey = config.DASHSCOPE_API_KEY?.trim();
      const openaiKey = config.OPENAI_API_KEY?.trim();
      const uniartKey = config.UNIART_API_KEY?.trim();
      const configured = config.secrets_configured || {};
      const hasOpenAICompatible = Boolean(openaiKey || uniartKey || configured.OPENAI_API_KEY || configured.UNIART_API_KEY);
      const hasRequired = config.LLM_PROVIDER === "openai" ? hasOpenAICompatible : Boolean(dashscopeKey);
      
      if (!hasRequired) {
        setEnvRequired(true);
        setIsEnvDialogOpen(true);
      }
    } catch (error) {
      console.error("Failed to check env config:", error);
      // 如果API调用失败，也显示配置对话框
      setEnvRequired(true);
      setIsEnvDialogOpen(true);
    }
  };

  return (
    <EnvConfigDialog
      isOpen={isEnvDialogOpen}
      onClose={() => {
        setIsEnvDialogOpen(false);
        setEnvRequired(false);
      }}
      isRequired={envRequired}
    />
  );
}
