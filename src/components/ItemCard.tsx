"use client";

import Image from "next/image";
import Link from "next/link";
import type { ItemImage } from "@/data/types";
import { useI18n } from "@/i18n/I18nProvider";
import { priceLabel } from "@/lib/format";
import { productPath, type ShopItem } from "@/lib/paths";
import { availabilityOf, coloursOf, metalOf, sizesOf } from "@/lib/shop";

export function ItemBadge({ item }: { item: Pick<ShopItem, "demo" | "draft" | "status"> }) {
  const { t } = useI18n();
  if (item.demo) return <span className="tag tag--demo">{t.badges.demo}</span>;
  if (item.draft) return <span className="tag tag--draft">{t.shop.card.draft}</span>;
  if (item.status === "sold") return <span className="tag tag--dark">{t.badges.sold}</span>;
  if (item.status === "reserved") return <span className="tag tag--dark">{t.badges.reserved}</span>;
  return null;
}

/**
 * Photos sit in one 3:4 frame. A photo already close to 3:4 fills it; any other shape is shown whole
 * on the ivory ground, so a bag, shoe or watch is never cut off.
 */
export function frameFit(image: Pick<ItemImage, "width" | "height">) {
  return Math.abs(image.width / image.height - 3 / 4) <= 0.05 ? "cover" : "contain";
}

/** The short line under a name: what matters for this category, from real data only. */
export function useSpecLine(item: ShopItem) {
  const { t, fmt, plural } = useI18n();
  const s = t.shop;
  const colours = coloursOf(item);
  const sizes = sizesOf(item);
  const colour = colours.length > 1 ? plural(colours.length, s.card.colours) : colours[0];
  const size =
    sizes.length > 1 ? plural(sizes.length, s.card.sizes) : sizes[0] ? fmt(s.card.size, { size: item.sizeSystem ? `${item.sizeSystem} ${sizes[0]}` : sizes[0] }) : undefined;
  const parts =
    item.category === "watches"
      ? [item.caseDiameterMm ? fmt(s.listing.mm, { n: item.caseDiameterMm }) : undefined, item.movement ? s.movements[item.movement] : undefined]
      : item.category === "jewellery"
        ? [metalOf(item), size]
        : [size, colour];
  return parts.filter(Boolean).join(" · ");
}

/** Product card: a real link to the piece's page, so it works without JavaScript, in new tabs and when shared. */
export function ItemCard({
  item,
  sizes = "(min-width: 1200px) 23vw, (min-width: 768px) 31vw, 47vw",
  priority = false,
}: {
  item: ShopItem;
  sizes?: string;
  priority?: boolean;
}) {
  const { t, href } = useI18n();
  const [first, second] = item.images;
  const spec = useSpecLine(item);
  const availability = availabilityOf(item);

  return (
    <article className="card">
      <Link href={href(productPath(item.ref))} className="card__link">
        <div className={`card__media${second ? " card__media--swap" : ""}`}>
          {first && (
            <Image src={first.src} alt={first.alt} width={first.width} height={first.height} sizes={sizes} quality={95} priority={priority} className={`card__img card__img--${frameFit(first)}`} />
          )}
          {second && (
            <Image src={second.src} alt="" width={second.width} height={second.height} sizes={sizes} quality={95} className={`card__img card__img--alt card__img--${frameFit(second)}`} />
          )}
          <div className="card__badge">
            <ItemBadge item={item} />
          </div>
        </div>
        <div className="card__body">
          {item.brand && (
            <p className="card__brand" lang="en" dir="ltr">
              {item.brand}
            </p>
          )}
          <h3 className="card__name">{item.name}</h3>
          {spec && <p className="card__meta">{spec}</p>}
          <p className="card__price">{priceLabel(item, t.price)}</p>
          {availability !== "sold" && availability !== "reserved" && <p className={`card__avail card__avail--${availability}`}>{t.shop.availability[availability]}</p>}
        </div>
      </Link>
    </article>
  );
}
