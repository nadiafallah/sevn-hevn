"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";

type Variant = "drawer" | "drawer-left" | "center" | "wide";

/**
 * Accessible modal built on the native <dialog> element:
 * showModal() gives focus containment, an inert background and Escape handling;
 * the browser returns focus to the triggering element on close.
 * Background scrolling is locked in CSS (html:has(dialog[open])).
 */
export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  variant = "drawer",
  children,
  footer,
  hideTitle = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  variant?: Variant;
  children: ReactNode;
  footer?: ReactNode;
  hideTitle?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector(".dlg__body")?.scrollTo?.({ top: 0 });
      // When one panel replaces another, the closing dialog may restore focus elsewhere;
      // make sure focus ends up inside the newly opened panel.
      requestAnimationFrame(() => {
        if (dialog.open && !dialog.contains(document.activeElement)) {
          dialog.querySelector<HTMLElement>("[autofocus], .dlg__close")?.focus();
        }
      });
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dlg dlg--${variant}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        // Clicks on the backdrop target the <dialog> element itself.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dlg__panel">
        <header className="dlg__head">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={titleId} className={hideTitle ? "visually-hidden" : "dlg__title"}>
              {title}
            </h2>
          </div>
          <button type="button" className="icon-btn dlg__close" onClick={onClose} aria-label={t.close}>
            <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
              <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.25" fill="none" />
            </svg>
          </button>
        </header>
        <div className="dlg__body">{open ? children : null}</div>
        {footer && open && <footer className="dlg__foot">{footer}</footer>}
      </div>
    </dialog>
  );
}
