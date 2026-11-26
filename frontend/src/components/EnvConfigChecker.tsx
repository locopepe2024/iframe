"use client";

import { useState, useEffect } from "react";
import EnvConfigDialog from "@/components/project/EnvConfigDialog";
import { isHomeRoute } from "@/lib/appRoutes";
import { api } from "@/lib/api";
import { refreshUniArtModelCatalog } from "@/lib/modelCatalog";

export function isDirectorRoute(hash: string): boolean {
  return hash === "#/director";
}

function skipsEnvironmentSetup(hash: string): boolean {
  return isHomeRoute(hash) || isDirectorRoute(hash);
}

export default function EnvConfigChecker() {
  const [isEnvDialogOpen, setIsEnvDialogOpen] = useState(false);
  const [envRequired, setEnvRequired] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [skipSetup, setSkipSetup] = useState(() =>
    typeof window !== "undefined" && skipsEnvironmentSetup(window.location.hash),
  );

  useEffect(() => {
    const syncRoute = () => {
      setSkipSetup(skipsEnvironmentSetup(window.location.hash));
    };
    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    // 只在客户端执行，且只检查一次
    if (typeof window === "undefined" || hasChecked || skipSetup || skipsEnvironmentSetup(window.location.hash)) return;

    checkEnvConfig();
    void refreshUniArtModelCatalog().then((count) => {
      if (!skipsEnvironmentSetup(window.location.hash) && count > 0 && !sessionStorage.getItem("lumenx_uniart_catalog_reloaded")) {
        sessionStorage.setItem("lumenx_uniart_catalog_reloaded", "1");
        window.location.reload();
      }
    });
    setHasChecked(true);
  }, [skipSetup, hasChecked]);

  const checkEnvConfig = async () => {
    if (skipsEnvironmentSetup(window.location.hash)) return;
    try {
      const config = await api.getUserConfig();
      const hasRequired = Boolean(config.runtime_uniart_available);

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
      isOpen={!skipSetup && isEnvDialogOpen}
      onClose={() => {
        setIsEnvDialogOpen(false);
        setEnvRequired(false);
      }}
      isRequired={envRequired}
    />
  );
}
