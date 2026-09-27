"use client";

import Image from "next/image";
import { useState } from "react";
import type { Item } from "@/data/types";
import { conditionLabels } from "@/data/types";
import { categoryById } from "@/data/taxonomy";
import { isPurchasable, priceLabel } from "@/lib/format";
import { itemMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { site } from "@/config/site";
import { useSite } from "./SiteProvider";
import { ItemBadge } from "./ItemCard";
import { PhoneIcon, WhatsAppIcon } from "./icons";

export function ProductDetail({ item }: { item: Item }) {
  const { cart, openPanel } = useSite();
  const [active, setActive] = useState(0);
  const image = item.images[active] ?? item.images[0];
  const preview = item.status === "editorial_preview";
  const buyable = isPurchasable(item);
  const inBag = cart.has(item.ref);
  const title = item.brand ? `${item.brand} ${item.name}` : item.name;

  const specs: [string, string | undefined][] = preview
    ? [["Category", categoryById[item.category]?.label]]
    : [
        ["Designer", item.brand],
        ["Category", [categoryById[item.category]?.label, item.subcategory].filter(Boolean).join(" · ")],
        ["Model / reference", item.modelReference],
        ["Condition", item.condition ? conditionLabels[item.condition] : undefined],
        ["Condition notes", item.conditionNotes],
        ["Year", item.year],
        ["Material", item.material],
        ["Colour", item.colour],
        ["Size", item.size],
        ["Dimensions", item.dimensions],
        ["Included", item.included?.length ? item.included.join(", ") : undefined],
        ["Documentation", item.authentication],
      ];

  const waHref = whatsappUrl(itemMessage(item));

  return (
    <div className="pd">
      <div className="pd__gallery">
        {image && (
          <div className="pd__main">
            <Image key={image.src} src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(min-width: 900px) 50vw, 100vw" priority className="pd__img" />
            {preview && <span className="media-label">AI-generated editorial image</span>}
          </div>
        )}
        {item.images.length > 1 && (
          <div className="pd__thumbs" role="group" aria-label="Choose image">
            {item.images.map((im, i) => (
              <button key={im.src} type="button" className="pd__thumb" aria-pressed={i === active} aria-label={`Image ${i + 1} of ${item.images.length}`} onClick={() => setActive(i)}>
                <Image src={im.src} alt="" width={120} height={150} sizes="80px" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pd__info">
        <div className="pd__badges">
          <ItemBadge item={item} />
        </div>
        {item.brand && <p className="eyebrow">{item.brand}</p>}
        <p className="pd__name" aria-hidden="true">
          {item.name}
        </p>
        <p className="pd__ref">Ref. {item.ref}</p>
        {!preview && <p className="pd__price">{priceLabel(item)}</p>}

        {preview && (
          <div className="notice">
            <p>
              <strong>Editorial preview.</strong> {item.editorialNote ?? "This AI-generated image is not an item for sale."} It shows no specific piece, condition or availability.
            </p>
          </div>
        )}

        {item.description && <p className="pd__desc">{item.description}</p>}

        <dl className="pd__specs">
          {specs
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>

        <div className="pd__actions">
          {buyable && (
            <button
              type="button"
              className="btn btn--dark btn--block"
              disabled={inBag}
              onClick={() => {
                cart.add(item.ref);
                openPanel({ type: "cart" });
              }}
            >
              {inBag ? "In your bag" : "Add to bag"}
            </button>
          )}

          {preview ? (
            <>
              <button
                type="button"
                className="btn btn--dark btn--block"
                onClick={() => openPanel({ type: "sourcing", prefill: { category: item.category, details: `Something like “${item.name}”: ${item.description ?? ""}`.trim(), relatedRef: item.ref } })}
              >
                Request something similar
              </button>
              <a className="btn btn--line btn--block" href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "preview", ref: item.ref })}>
                <WhatsAppIcon size={18} /> Ask on WhatsApp
              </a>
            </>
          ) : item.status === "sold" || item.status === "reserved" ? (
            <>
              <button
                type="button"
                className="btn btn--dark btn--block"
                onClick={() => openPanel({ type: "sourcing", prefill: { category: item.category, brand: item.brand, model: item.name, relatedRef: item.ref } })}
              >
                Request a similar piece
              </button>
              <a className="btn btn--line btn--block" href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "item", ref: item.ref })}>
                <WhatsAppIcon size={18} /> Ask on WhatsApp
              </a>
            </>
          ) : (
            <>
              <a
                className={`btn btn--block ${buyable ? "btn--line" : "btn--dark"}`}
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track("whatsapp_click", { source: "item", ref: item.ref })}
              >
                <WhatsAppIcon size={18} /> Enquire on WhatsApp
              </a>
              <button type="button" className="btn btn--line btn--block" onClick={() => openPanel({ type: "viewing", prefill: { interest: title, relatedRef: item.ref } })}>
                Arrange a private viewing
              </button>
            </>
          )}
        </div>

        <p className="pd__alt">
          <PhoneIcon size={16} /> Prefer to talk? <a href={site.contact.telHref}>{site.contact.phoneDisplay}</a> · <a href={site.contact.emailHref}>Email</a>
        </p>

        {!preview && (
          <div className="pd__service">
            <h3>Delivery &amp; returns</h3>
            <p>{item.delivery ?? "Delivery options and timing are confirmed with you personally before any payment."}</p>
            {item.returns && <p>{item.returns}</p>}
            {buyable && <p className="muted small">Adding a piece to your bag does not reserve it.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
