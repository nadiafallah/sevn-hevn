"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatAED, isPurchasable, maxQuantity, priceLabel } from "@/lib/format";
import { cartMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { useSite, type CartCatalogItem } from "./SiteProvider";
import { WhatsAppIcon } from "./icons";

type Issue = { ref: string; message: string };
type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable"; totalLabel: string; lines: { ref: string; name: string; quantity: number }[] }
  | { kind: "issues"; issues: Issue[] }
  | { kind: "error"; message: string };

export function CartPanel() {
  const { cart, catalog, closePanel, openPanel } = useSite();
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const rows = cart.lines.map((l) => ({ line: l, item: catalog[l.ref] as CartCatalogItem | undefined }));
  const valid = rows.filter((r) => r.item && isPurchasable(r.item));
  const subtotal = valid.reduce((s, r) => s + (r.item!.priceAED ?? 0) * r.line.qty, 0);
  const issueFor = (ref: string) => (result.kind === "issues" ? result.issues.find((i) => i.ref === ref)?.message : undefined);

  async function checkout() {
    setResult({ kind: "loading" });
    track("checkout_start", { lines: cart.lines.length });
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cart.lines.map((l) => ({ ref: l.ref, qty: l.qty })) }),
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
      setResult({ kind: "error", message: data.error || "Something went wrong. Please try again." });
    } catch {
      setResult({ kind: "error", message: "We couldn’t reach the server. Check your connection and try again." });
    }
  }

  if (!cart.ready) return <p className="muted">Loading your bag…</p>;

  if (rows.length === 0) {
    return (
      <div className="cart-empty">
        <p className="cart-empty__title">Your bag is empty.</p>
        <p className="muted">Pieces available for online purchase can be added here. Everything else can be requested personally.</p>
        <div className="stack-actions">
          <Link href="/collection" className="btn btn--dark" onClick={closePanel}>
            Explore the Collection
          </Link>
          <button type="button" className="btn btn--line" onClick={() => openPanel({ type: "sourcing" })}>
            Request a Piece
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
          const problem = issueFor(line.ref) ?? (!item ? "This piece is no longer listed." : !ok ? (item.status === "sold" ? "This piece has been sold." : item.status === "reserved" ? "This piece is reserved." : "No longer available to buy online.") : undefined);
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
                  {item?.demo && <span className="tag tag--demo">Demo — not for sale</span>}
                </p>
                <p className="muted small">Ref. {line.ref}</p>
                {problem ? (
                  <p className="cart-line__problem" role="note">
                    {problem}{" "}
                    <button type="button" className="link-btn" onClick={() => openPanel({ type: "sourcing", prefill: { relatedRef: line.ref, model: item?.name } })}>
                      Request a similar piece
                    </button>
                  </p>
                ) : max > 1 ? (
                  <label className="qty">
                    <span>Qty</span>
                    <select value={line.qty} onChange={(e) => cart.setQty(line.ref, Number(e.target.value))}>
                      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="muted small">One-of-a-kind piece · quantity 1</p>
                )}
              </div>
              <div className="cart-line__side">
                <p className="cart-line__price">{item ? priceLabel(item) : "—"}</p>
                <button type="button" className="link-btn" onClick={() => cart.remove(line.ref)} aria-label={`Remove ${item?.name ?? line.ref} from bag`}>
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="cart__summary">
        <div className="cart__total">
          <span>Subtotal</span>
          <span>{valid.length ? formatAED(subtotal) : "—"}</span>
        </div>
        <p className="muted small">Delivery is confirmed before payment. Adding a piece to your bag does not reserve it.</p>

        {result.kind === "unavailable" ? (
          <div className="notice" role="status">
            <p>
              <strong>Online payment is not available yet.</strong> We’ve checked your selection ({result.totalLabel}). Send it to our team and we’ll confirm availability, delivery and
              payment personally.
            </p>
            <a
              className="btn btn--dark btn--block"
              href={whatsappUrl(cartMessage(result.lines.map((l) => ({ name: l.name, ref: l.ref, qty: l.quantity })), result.totalLabel))}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("whatsapp_click", { source: "bag" })}
            >
              <WhatsAppIcon size={18} /> Continue on WhatsApp
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
                Some pieces need attention. Remove them to continue.
              </p>
            )}
            <button type="button" className="btn btn--dark btn--block" onClick={checkout} disabled={result.kind === "loading" || valid.length === 0} aria-busy={result.kind === "loading"}>
              {result.kind === "loading" ? "Checking availability…" : "Checkout"}
            </button>
            {valid.length === 0 && <p className="muted small">Nothing in your bag can be purchased online right now.</p>}
          </>
        )}
      </div>
    </div>
  );
}
