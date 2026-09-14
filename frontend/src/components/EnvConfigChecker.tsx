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
      const config = await api.getUserConfig();
      const hasRequired = Boolean(config.secrets_configured?.UNIART_API_KEY);
      
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
