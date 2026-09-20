"use client";

import { useState, useEffect } from "react";
import EnvConfigDialog from "@/components/project/EnvConfigDialog";
import { api } from "@/lib/api";
import { refreshUniArtModelCatalog } from "@/lib/modelCatalog";

export function isDirectorRoute(hash: string): boolean {
  return hash === "#/director";
}

export default function EnvConfigChecker() {
  const [isEnvDialogOpen, setIsEnvDialogOpen] = useState(false);
  const [envRequired, setEnvRequired] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [directorRouteActive, setDirectorRouteActive] = useState(() =>
    typeof window !== "undefined" && isDirectorRoute(window.location.hash),
  );

  useEffect(() => {
    const syncRoute = () => {
      setDirectorRouteActive(isDirectorRoute(window.location.hash));
    };
    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    // 只在客户端执行，且只检查一次
    if (typeof window === "undefined" || hasChecked || directorRouteActive || isDirectorRoute(window.location.hash)) return;

    checkEnvConfig();
    void refreshUniArtModelCatalog().then((count) => {
      if (!isDirectorRoute(window.location.hash) && count > 0 && !sessionStorage.getItem("lumenx_uniart_catalog_reloaded")) {
        sessionStorage.setItem("lumenx_uniart_catalog_reloaded", "1");
        window.location.reload();
      }
    });
    setHasChecked(true);
  }, [directorRouteActive, hasChecked]);

  useEffect(() => {
    if (!directorRouteActive) return;
    // The director is a browser-only workbench and must not be blocked by
    // the account-scoped UniArt configuration gate.
    setIsEnvDialogOpen(false);
    setEnvRequired(false);
  }, [directorRouteActive]);

  const checkEnvConfig = async () => {
    if (isDirectorRoute(window.location.hash)) return;
    try {
      const config = await api.getUserConfig();
      const hasRequired = Boolean(config.secrets_configured?.UNIART_API_KEY);

      if (!isDirectorRoute(window.location.hash) && !hasRequired) {
        setEnvRequired(true);
        setIsEnvDialogOpen(true);
      }
    } catch (error) {
      console.error("Failed to check env config:", error);
      // 如果API调用失败，也显示配置对话框
      if (!isDirectorRoute(window.location.hash)) {
        setEnvRequired(true);
        setIsEnvDialogOpen(true);
      }
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
