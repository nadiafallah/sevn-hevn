"use client";

import Image from "next/image";
import Link from "next/link";
import { findVariant, formatAED, isPurchasable, maxQuantity, priceLabel, unitPrice } from "@/lib/format";
import type { ShopItem } from "@/lib/paths";
import { productPath } from "@/lib/paths";
import { variantText } from "@/lib/whatsapp";
import { useI18n } from "@/i18n/I18nProvider";
import { lineKey, useSite, type CartLine } from "./SiteProvider";

/** A bag line with its piece and version, and whether it can still be bought online. */
export function resolveLine(line: CartLine, itemByRef: Record<string, ShopItem>) {
  const item = itemByRef[line.ref];
  const variant = item ? findVariant(item, line.sku) : undefined;
  // A line saved for a version that no longer exists can't be bought as it is.
  const versionGone = !!item && !!line.sku && !variant;
  const ok = !!item && !versionGone && isPurchasable(item, variant) && (!item.variants?.length || !!variant);
  const unit = item ? unitPrice(item, variant) : undefined;
  const image = item ? (variant?.imageIndex !== undefined ? item.images[variant.imageIndex] : undefined) ?? item.images[0] : undefined;
  return { line, item, variant, ok, unit, image, key: lineKey(line) };
}

export function CartPanel() {
  const { cart, itemByRef, closePanel, openPanel } = useSite();
  const { t, href, fmt } = useI18n();
  const c = t.cart;
  const s = t.shop;

  const rows = cart.lines.map((l) => resolveLine(l, itemByRef));
  const valid = rows.filter((r) => r.ok);
  const subtotal = valid.reduce((sum, r) => sum + (r.unit ?? 0) * r.line.qty, 0);

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
        {rows.map(({ line, item, variant, ok, unit, image, key }) => {
          const problem = !item ? c.noLonger : !ok ? (item.status === "sold" ? c.sold : item.status === "reserved" ? c.reserved : c.notOnline) : undefined;
          const max = item ? maxQuantity(item, variant) : 1;
          const options = variantText(variant);
          return (
            <li key={key} className={`cart-line${problem ? " cart-line--problem" : ""}`}>
              <div className="cart-line__img">{image && <Image src={image.src} alt="" width={image.width} height={image.height} sizes="96px" />}</div>
              <div className="cart-line__info">
                {item?.brand && (
                  <p className="eyebrow" lang="en" dir="ltr">
                    {item.brand}
                  </p>
                )}
                <p className="cart-line__name">
                  {item ? (
                    <Link href={href(productPath(item.ref) + (variant ? `?sku=${encodeURIComponent(variant.sku)}` : ""))} onClick={closePanel}>
                      {item.name}
                    </Link>
                  ) : (
                    line.ref
                  )}
                  {item?.demo && <span className="tag tag--demo">{t.badges.demo}</span>}
                </p>
                {options && <p className="small">{options}</p>}
                <p className="muted small">
                  {s.product.code} <bdi dir="ltr">{variant && variant.sku !== line.ref ? `${line.ref} / ${variant.sku}` : line.ref}</bdi>
                </p>
                {problem ? (
                  <p className="cart-line__problem" role="note">
                    {problem}{" "}
                    <button type="button" className="link-btn" onClick={() => openPanel({ type: "sourcing", prefill: { relatedRef: line.ref, brand: item?.brand, model: item?.name } })}>
                      {c.requestSimilar}
                    </button>
                  </p>
                ) : max > 1 ? (
                  <label className="qty">
                    <span>{c.qty}</span>
                    <select value={line.qty} onChange={(e) => cart.setQty(key, Number(e.target.value))}>
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
                <p className="cart-line__price" dir="ltr">
                  {item ? (ok && unit ? formatAED(unit * line.qty) : priceLabel(item, t.price, variant)) : "—"}
                </p>
                {ok && unit && line.qty > 1 && (
                  <p className="muted small">
                    {s.bag.unitPrice} <bdi dir="ltr">{formatAED(unit)}</bdi>
                  </p>
                )}
                <button type="button" className="link-btn" onClick={() => cart.remove(key)} aria-label={fmt(c.removeLabel, { name: item?.name ?? line.ref })}>
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
        <p className="muted small">{s.bag.note}</p>
        {valid.length > 0 ? (
          <Link href={href("/checkout")} className="btn btn--dark btn--block" onClick={closePanel}>
            {s.bag.checkout}
          </Link>
        ) : (
          <p className="muted small">{c.nothingOnline}</p>
        )}
        <button type="button" className="link-btn small" onClick={closePanel}>
          {s.bag.continue}
        </button>
      </div>
    </div>
  );
}
