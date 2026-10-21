"use client";

import { usePathname } from "next/navigation";
import { Providers } from "@/components/Providers";
import EnvConfigChecker from "@/components/EnvConfigChecker";
import TauriDragBar from "@/components/layout/TauriDragBar";

export function ApplicationBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (/^(?:\/static)?\/companion(?:\/copilot-trial)?(?:\.html|\/)?$/.test(pathname ?? "")) return <>{children}</>;
  return <Providers><TauriDragBar /><EnvConfigChecker />{children}</Providers>;
}
