"use client";

import Image from "next/image";
import type { Item } from "@/data/types";
import { useI18n } from "@/i18n/I18nProvider";
import { priceLabel } from "@/lib/format";
import { ArrowIcon } from "./icons";

export function ItemBadge({ item }: { item: Item }) {
  const { t } = useI18n();
  if (item.demo) return <span className="tag tag--demo">{t.badges.demo}</span>;
  if (item.status === "editorial_preview") return <span className="tag">{t.badges.preview}</span>;
  if (item.status === "sold") return <span className="tag tag--dark">{t.badges.sold}</span>;
  if (item.status === "reserved") return <span className="tag tag--dark">{t.badges.reserved}</span>;
  return null;
}

/**
 * Product card. Rendered as a real link to /collection?item=REF so it works without
 * JavaScript, in new tabs and when shared; the Collection page intercepts clicks to open
 * the detail panel in place.
 */
export function ItemCard({
  item,
  sizes = "(min-width: 1100px) 25vw, (min-width: 700px) 33vw, 50vw",
  onOpen,
  priority = false,
}: {
  item: Item;
  sizes?: string;
  onOpen?: (ref: string) => void;
  priority?: boolean;
}) {
  const { t, href } = useI18n();
  const [first, second] = item.images;
  const link = href(`/collection?item=${encodeURIComponent(item.ref)}`);
  const meta =
    item.status === "editorial_preview"
      ? (item.tagline ?? item.description)
      : [item.condition && t.conditions[item.condition], item.year].filter(Boolean).join(" · ");

  return (
    <article className="card">
      <a
        href={link}
        className="card__link"
        onClick={
          onOpen
            ? (e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onOpen(item.ref);
              }
            : undefined
        }
      >
        <div className={`card__media${second ? " card__media--swap" : ""}`}>
          {first && <Image src={first.src} alt={first.alt} width={first.width} height={first.height} sizes={sizes} priority={priority} className="card__img" />}
          {second && <Image src={second.src} alt="" width={second.width} height={second.height} sizes={sizes} className="card__img card__img--alt" />}
          <div className="card__badge">
            <ItemBadge item={item} />
          </div>
        </div>
        <div className="card__body">
          {item.brand && <p className="card__brand">{item.brand}</p>}
          <h3 className="card__name">{item.name}</h3>
          {meta && <p className="card__meta">{meta}</p>}
          {item.status !== "editorial_preview" && <p className="card__price">{priceLabel(item, t.price)}</p>}
          <span className="card__more" aria-hidden="true">
            {t.card.more} <ArrowIcon size={13} />
          </span>
        </div>
      </a>
    </article>
  );
}
