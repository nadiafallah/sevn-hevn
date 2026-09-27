"use client";

import type { ReactNode } from "react";
import { useSite, type Panel } from "./SiteProvider";

/** A button usable from server components that opens a site panel. */
export function PanelButton({ panel, className, children }: { panel: Panel; className?: string; children: ReactNode }) {
  const { openPanel } = useSite();
  return (
    <button type="button" className={className} onClick={() => openPanel(panel)}>
      {children}
    </button>
  );
}
