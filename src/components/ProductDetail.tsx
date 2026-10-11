"use client";

import Image from "next/image";
import { useState } from "react";
import type { Item } from "@/data/types";
import { isCategoryId } from "@/data/taxonomy";
import { useI18n } from "@/i18n/I18nProvider";
import { isPurchasable, priceLabel } from "@/lib/format";
import { itemMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { site } from "@/config/site";
import { useSite } from "./SiteProvider";
import { ItemBadge } from "./ItemCard";
import { PhoneIcon, WhatsAppIcon } from "./icons";

export function ProductDetail({ item }: { item: Item }) {
  const { cart, openPanel } = useSite();
  const { t, locale, fmt } = useI18n();
  const p = t.product;
  const [active, setActive] = useState(0);
  const image = item.images[active] ?? item.images[0];
  const preview = item.status === "editorial_preview";
  const buyable = isPurchasable(item);
  const inBag = cart.has(item.ref);
  const title = item.brand ? `${item.brand} ${item.name}` : item.name;
  const category = isCategoryId(item.category) ? t.categories[item.category] : undefined;
  const subcategory = item.subcategory ? (t.subcategories[item.subcategory] ?? item.subcategory) : undefined;

  const specs: [string, string | undefined][] = preview
    ? [[p.specs.category, category]]
    : [
        [p.specs.designer, item.brand],
        [p.specs.category, [category, subcategory].filter(Boolean).join(" · ")],
        [p.specs.model, item.modelReference],
        [p.specs.condition, item.condition ? t.conditions[item.condition] : undefined],
        [p.specs.conditionNotes, item.conditionNotes],
        [p.specs.year, item.year],
        [p.specs.material, item.material],
        [p.specs.colour, item.colour],
        [p.specs.size, item.size],
        [p.specs.dimensions, item.dimensions],
        [p.specs.included, item.included?.length ? item.included.join(", ") : undefined],
        [p.specs.documentation, item.authentication],
      ];

  const waHref = whatsappUrl(itemMessage(item, t.messages, locale));

  return (
    <div className="pd">
      <div className="pd__gallery">
        {image && (
          <div className="pd__main">
            <Image key={image.src} src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(min-width: 900px) 50vw, 100vw" priority className="pd__img" />
            {preview && <span className="media-label">{t.aiImage}</span>}
          </div>
        )}
        {item.images.length > 1 && (
          <div className="pd__thumbs" role="group" aria-label={p.chooseImage}>
            {item.images.map((im, i) => (
              <button
                key={im.src}
                type="button"
                className="pd__thumb"
                aria-pressed={i === active}
                aria-label={fmt(p.imageOf, { n: i + 1, total: item.images.length })}
                onClick={() => setActive(i)}
              >
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
        <p className="pd__ref">
          {p.ref} <bdi dir="ltr">{item.ref}</bdi>
        </p>
        {!preview && <p className="pd__price">{priceLabel(item, t.price)}</p>}

        {preview && (
          <div className="notice">
            <p>
              <strong>{p.previewStrong}</strong> {item.editorialNote ?? p.previewDefault} {p.previewTail}
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
              {inBag ? p.inBag : p.addToBag}
            </button>
          )}

          {preview ? (
            <>
              <button
                type="button"
                className="btn btn--dark btn--block"
                onClick={() =>
                  openPanel({
                    type: "sourcing",
                    prefill: { category: item.category, details: fmt(p.similarPrefill, { name: item.name, description: item.description ?? "" }).trim(), relatedRef: item.ref },
                  })
                }
              >
                {p.requestSomethingSimilar}
              </button>
              <a className="btn btn--line btn--block" href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "preview", ref: item.ref })}>
                <WhatsAppIcon size={18} /> {p.askWhatsApp}
              </a>
            </>
          ) : item.status === "sold" || item.status === "reserved" ? (
            <>
              <button
                type="button"
                className="btn btn--dark btn--block"
                onClick={() => openPanel({ type: "sourcing", prefill: { category: item.category, brand: item.brand, model: item.name, relatedRef: item.ref } })}
              >
                {p.requestSimilar}
              </button>
              <a className="btn btn--line btn--block" href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "item", ref: item.ref })}>
                <WhatsAppIcon size={18} /> {p.askWhatsApp}
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
                <WhatsAppIcon size={18} /> {p.enquireWhatsApp}
              </a>
              <button type="button" className="btn btn--line btn--block" onClick={() => openPanel({ type: "viewing", prefill: { interest: title, relatedRef: item.ref } })}>
                {p.arrangeViewing}
              </button>
            </>
          )}
        </div>

        <p className="pd__alt">
          <PhoneIcon size={16} /> {p.preferTalk}{" "}
          <a href={site.contact.telHref} dir="ltr">
            {site.contact.phoneDisplay}
          </a>{" "}
          · <a href={site.contact.emailHref}>{p.email}</a>
        </p>

        {!preview && (
          <div className="pd__service">
            <h3>{p.deliveryTitle}</h3>
            <p>{item.delivery ?? p.deliveryDefault}</p>
            {item.returns && <p>{item.returns}</p>}
            {buyable && <p className="muted small">{p.notReserved}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
