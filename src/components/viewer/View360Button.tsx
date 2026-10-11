"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { Item } from "@/data/types";
import { useI18n } from "@/i18n/I18nProvider";
import { Dialog } from "../Dialog";
import "./entry.css";

/** The viewer's code (and, for models, three.js) is downloaded only when a customer opens it. */
export const LazyProductViewer = dynamic(() => import("./ProductViewer").then((m) => m.ProductViewer), {
  ssr: false,
  loading: () => <div className="pv__stage" aria-busy="true" />,
});

type ViewItem = Pick<Item, "ref" | "name" | "brand" | "view" | "interior" | "showcase">;

/** "360° View" on a product card. Shown only for pieces whose view is switched on and valid. */
export function View360Button({ item }: { item: ViewItem }) {
  const { t, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  if (!item.view) return null;
  const title = item.brand ? `${item.brand} ${item.name}` : item.name;
  return (
    <>
      <button type="button" className="card__360" aria-label={fmt(t.viewer.buttonLabel, { name: title })} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M3 12c0-2.2 4-4 9-4s9 1.8 9 4-4 4-9 4M12 16l2-2M12 16l2 2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
        {t.viewer.button}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} eyebrow={t.viewer.title} variant="wide" hideTitle className="pv-dialog">
        <div className="pv-dialog__inner">{open && <LazyProductViewer item={item} />}</div>
      </Dialog>
    </>
  );
}
