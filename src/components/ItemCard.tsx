import Image from "next/image";
import type { Item } from "@/data/types";
import { conditionLabels } from "@/data/types";
import { priceLabel } from "@/lib/format";

export function ItemBadge({ item }: { item: Item }) {
  if (item.demo) return <span className="tag tag--demo">Demo — not for sale</span>;
  if (item.status === "editorial_preview") return <span className="tag">Editorial preview</span>;
  if (item.status === "sold") return <span className="tag tag--dark">Sold</span>;
  if (item.status === "reserved") return <span className="tag tag--dark">Reserved</span>;
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
  const [first, second] = item.images;
  const href = `/collection?item=${encodeURIComponent(item.ref)}`;
  const meta =
    item.status === "editorial_preview"
      ? item.description
      : [item.condition && conditionLabels[item.condition], item.year].filter(Boolean).join(" · ");

  return (
    <article className="card">
      <a
        href={href}
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
          {item.status !== "editorial_preview" && <p className="card__price">{priceLabel(item)}</p>}
        </div>
      </a>
    </article>
  );
}
