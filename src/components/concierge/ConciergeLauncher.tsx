"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";

// The chat code loads only when someone opens it, so it adds nothing to the first page load.
const ConciergeChat = dynamic(() => import("./ConciergeChat").then((m) => m.ConciergeChat), {
  ssr: false,
  loading: () => <div className="cc cc--widget cc--loading" aria-busy="true" />,
});

/**
 * Floating "Concierge" button that opens the chat panel. It sits above the WhatsApp button (which
 * stays visible and works as before), hides while a site panel is open, and is not shown on /chat.
 */
export function ConciergeLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Deep link: any page with #concierge opens the chat.
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash === "#concierge") {
        setMounted(true);
        setOpen(true);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  if (pathname === "/chat") return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="cc-launcher"
        aria-expanded={open}
        aria-controls="concierge-panel"
        aria-label="Open the SEVN HEVN concierge chat"
        hidden={open}
        onClick={() => {
          setMounted(true);
          setOpen(true);
          track("concierge_open", { source: "launcher" });
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M4 5.5h16v10H9.5L5.5 19v-3.5H4z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
          <path d="M8 10.5h.01M12 10.5h.01M16 10.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="cc-launcher__label">Concierge</span>
      </button>
      {mounted && (
        <div ref={panelRef} id="concierge-panel" className="cc-panel" data-open={open} hidden={!open}>
          <ConciergeChat variant="widget" active={open} onClose={close} />
        </div>
      )}
    </>
  );
}
