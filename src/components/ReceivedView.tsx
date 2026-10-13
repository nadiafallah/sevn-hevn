"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { interpolate } from "@/i18n/rich";
import { whatsappUrl } from "@/lib/whatsapp";
import { RECEIVED_KEY } from "./CheckoutView";
import { WhatsAppIcon } from "./icons";

const REF = /^[A-Z0-9-]{4,24}$/;
const noop = () => () => {};

function readSaved(): string | null {
  try {
    return window.sessionStorage.getItem(RECEIVED_KEY);
  } catch {
    return null;
  }
}

/**
 * After a purchase request is stored: its reference and what happens next. It is not an order
 * confirmation and never says anything was paid. The prepared WhatsApp message is kept for this tab
 * only; the reference in the address is all that is shown otherwise.
 */
export function ReceivedView() {
  const params = useSearchParams();
  const { t, href, fmt } = useI18n();
  const r = t.shop.received;
  const raw = useSyncExternalStore(noop, readSaved, () => null);
  const saved = raw ? (JSON.parse(raw) as { reference?: string; message?: string }) : null;
  const ref = params.get("ref")?.toUpperCase() ?? "";
  const valid = REF.test(ref);
  const message = saved?.reference === ref ? saved.message : undefined;

  return (
    <div className="container received">
      <p className="eyebrow">{r.eyebrow}</p>
      <h1 className="display display--sm">{r.title}</h1>
      {valid ? (
        <>
          <p className="received__lead">
            {interpolate(r.text, {
              ref: (
                <bdi dir="ltr" className="received__ref">
                  {ref}
                </bdi>
              ),
            })}
          </p>
          <p>{r.next}</p>
          <p className="muted small">{fmt(r.quote, { ref })}</p>
          <div className="stack-actions">
            <a className="btn btn--dark" href={whatsappUrl(message ?? fmt(t.shop.messages.requestRef, { ref }))} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon size={18} /> {r.whatsapp}
            </a>
            <Link href={href("/collection")} className="btn btn--line">
              {r.shop}
            </Link>
          </div>
        </>
      ) : (
        <>
          <p>{r.missing}</p>
          <Link href={href("/collection")} className="btn btn--line">
            {r.shop}
          </Link>
        </>
      )}
    </div>
  );
}
