"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatAED, isPurchasable, maxQuantity, priceLabel } from "@/lib/format";
import { cartMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { useI18n } from "@/i18n/I18nProvider";
import { interpolate } from "@/i18n/rich";
import { useSite, type CartCatalogItem } from "./SiteProvider";
import { WhatsAppIcon } from "./icons";

type IssueCode = "not_found" | "not_for_sale" | "demo_item" | "insufficient_stock" | "invalid_quantity";
type Issue = { ref: string; code?: IssueCode; message: string; max?: number };
type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable"; totalLabel: string; lines: { ref: string; name: string; quantity: number }[] }
  | { kind: "issues"; issues: Issue[] }
  | { kind: "error"; message: string };

export function CartPanel() {
  const { cart, catalog, closePanel, openPanel } = useSite();
  const { t, href, fmt, locale } = useI18n();
  const c = t.cart;
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const rows = cart.lines.map((l) => ({ line: l, item: catalog[l.ref] as CartCatalogItem | undefined }));
  const valid = rows.filter((r) => r.item && isPurchasable(r.item));
  const subtotal = valid.reduce((s, r) => s + (r.item!.priceAED ?? 0) * r.line.qty, 0);
  // Server messages are in English for logs; the visitor sees the wording for the code.
  const issueText = (i: Issue) => (i.code === "invalid_quantity" ? fmt(c.issues.invalid_quantity, { n: i.max ?? 1 }) : i.code ? c.issues[i.code] : c.errorGeneric);
  const issueFor = (ref: string) => {
    const i = result.kind === "issues" ? result.issues.find((x) => x.ref === ref) : undefined;
    return i ? issueText(i) : undefined;
  };

  async function checkout() {
    setResult({ kind: "loading" });
    track("checkout_start", { lines: cart.lines.length });
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cart.lines.map((l) => ({ ref: l.ref, qty: l.qty })), locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.redirectUrl === "string") {
        window.location.assign(data.redirectUrl);
        return;
      }
      if (res.status === 409 && Array.isArray(data.issues)) return setResult({ kind: "issues", issues: data.issues });
      if (res.status === 503 && data.code === "payments_unavailable") {
        return setResult({ kind: "unavailable", totalLabel: data.verified.totalLabel, lines: data.verified.lines });
      }
      setResult({ kind: "error", message: c.errorGeneric });
    } catch {
      setResult({ kind: "error", message: c.errorNetwork });
    }
  }

  if (!cart.ready) return <p className="muted">{c.loading}</p>;

  if (rows.length === 0) {
    return (
      <div className="cart-empty">
        <p className="cart-empty__title">{c.emptyTitle}</p>
        <p className="muted">{c.emptyText}</p>
        <div className="stack-actions">
          <Link href={href("/collection")} className="btn btn--dark" onClick={closePanel}>
            {c.explore}
          </Link>
          <button type="button" className="btn btn--line" onClick={() => openPanel({ type: "sourcing" })}>
            {c.request}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cart">
      <ul className="cart__list">
        {rows.map(({ line, item }) => {
          const ok = item && isPurchasable(item);
          const problem = issueFor(line.ref) ?? (!item ? c.noLonger : !ok ? (item.status === "sold" ? c.sold : item.status === "reserved" ? c.reserved : c.notOnline) : undefined);
          const max = item ? maxQuantity(item) : 1;
          return (
            <li key={line.ref} className={`cart-line${problem ? " cart-line--problem" : ""}`}>
              <div className="cart-line__img">
                {item?.image && <Image src={item.image.src} alt="" width={96} height={120} sizes="96px" />}
              </div>
              <div className="cart-line__info">
                {item?.brand && <p className="eyebrow">{item.brand}</p>}
                <p className="cart-line__name">
                  {item?.name ?? line.ref}
                  {item?.demo && <span className="tag tag--demo">{t.badges.demo}</span>}
                </p>
                <p className="muted small">
                  {t.product.ref} <bdi dir="ltr">{line.ref}</bdi>
                </p>
                {problem ? (
                  <p className="cart-line__problem" role="note">
                    {problem}{" "}
                    <button type="button" className="link-btn" onClick={() => openPanel({ type: "sourcing", prefill: { relatedRef: line.ref, model: item?.name } })}>
                      {c.requestSimilar}
                    </button>
                  </p>
                ) : max > 1 ? (
                  <label className="qty">
                    <span>{c.qty}</span>
                    <select value={line.qty} onChange={(e) => cart.setQty(line.ref, Number(e.target.value))}>
                      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="muted small">{c.oneOfAKind}</p>
                )}
              </div>
              <div className="cart-line__side">
                <p className="cart-line__price">{item ? priceLabel(item, t.price) : "—"}</p>
                <button type="button" className="link-btn" onClick={() => cart.remove(line.ref)} aria-label={fmt(c.removeLabel, { name: item?.name ?? line.ref })}>
                  {c.remove}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="cart__summary">
        <div className="cart__total">
          <span>{c.subtotal}</span>
          <span dir="ltr">{valid.length ? formatAED(subtotal) : "—"}</span>
        </div>
        <p className="muted small">{c.note}</p>

        {result.kind === "unavailable" ? (
          <div className="notice" role="status">
            <p>
              <strong>{c.unavailableStrong}</strong> {interpolate(c.unavailableText, { total: <bdi dir="ltr">{result.totalLabel}</bdi> })}
            </p>
            <a
              className="btn btn--dark btn--block"
              href={whatsappUrl(
                cartMessage(
                  result.lines.map((l) => ({ name: catalog[l.ref]?.brand ? `${catalog[l.ref]!.brand} ${catalog[l.ref]!.name}` : (catalog[l.ref]?.name ?? l.name), ref: l.ref, qty: l.quantity })),
                  result.totalLabel,
                  t.messages,
                  locale,
                ),
              )}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("whatsapp_click", { source: "bag" })}
            >
              <WhatsAppIcon size={18} /> {c.continueWhatsApp}
            </a>
          </div>
        ) : (
          <>
            {result.kind === "error" && (
              <p className="field__error" role="alert">
                {result.message}
              </p>
            )}
            {result.kind === "issues" && (
              <p className="field__error" role="alert">
                {c.attention}
              </p>
            )}
            <button type="button" className="btn btn--dark btn--block" onClick={checkout} disabled={result.kind === "loading" || valid.length === 0} aria-busy={result.kind === "loading"}>
              {result.kind === "loading" ? c.checking : c.checkout}
            </button>
            {valid.length === 0 && <p className="muted small">{c.nothingOnline}</p>}
          </>
        )}
      </div>
    </div>
  );
}
