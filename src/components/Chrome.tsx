"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { useI18n } from "@/i18n/I18nProvider";
import { WhatsAppIcon } from "./icons";

/** Persistent WhatsApp entry point. Hidden while any panel is open (see CSS). */
export function WhatsAppFloat() {
  const { t } = useI18n();
  return (
    <a
      className="wa-float"
      href={whatsappUrl(generalMessage(t.messages))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t.chrome.whatsapp}
      onClick={() => track("whatsapp_click", { source: "float" })}
    >
      <WhatsAppIcon size={24} />
    </a>
  );
}

/**
 * Gentle section reveals. Content is fully visible without JavaScript and for
 * visitors who prefer reduced motion (handled in CSS).
 */
export function RevealObserver() {
  const pathname = usePathname();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);
  return null;
}
