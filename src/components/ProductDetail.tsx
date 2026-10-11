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
import { LazyProductViewer } from "./viewer/View360Button";

export function ProductDetail({ item }: { item: Item }) {
  const { cart, openPanel } = useSite();
  const { t, locale, fmt } = useI18n();
  const p = t.product;
  // A number is a photo; "view" is the 360° view.
  const [active, setActive] = useState<number | "view">(0);
  // Colourways that a 3D model carries: the photos and the model always show the same one.
  const variants = item.view?.kind === "model" ? item.view.variants : undefined;
  const [variantIndex, setVariantIndex] = useState(0);
  const variant = variants?.[variantIndex];
  const images = variant?.images.length ? variant.images : item.images;
  const image = active === "view" ? undefined : (images[active] ?? images[0]);
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
        {active === "view" && item.view ? (
          <div className="pd__main pd__main--view">
            <LazyProductViewer item={item} variant={variant?.name} onExit={() => setActive(0)} />
          </div>
        ) : (
          image && (
            <div className="pd__main">
              <Image key={image.src} src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(min-width: 900px) 50vw, 100vw" priority className="pd__img" />
              {item.showcase ? <span className="media-label">{t.showcase.imageLabel}</span> : preview && <span className="media-label">{t.aiImage}</span>}
            </div>
          )
        )}
        {(images.length > 1 || item.view) && (
          <div className="pd__thumbs" role="group" aria-label={p.chooseImage}>
            {images.map((im, i) => (
              <button
                key={im.src}
                type="button"
                className="pd__thumb"
                aria-pressed={i === active}
                aria-label={fmt(p.imageOf, { n: i + 1, total: images.length })}
                onClick={() => setActive(i)}
              >
                <Image src={im.src} alt="" width={120} height={150} sizes="80px" />
              </button>
            ))}
            {item.view && (
              <button type="button" className="pd__thumb pd__thumb--360" aria-pressed={active === "view"} aria-label={t.viewer.title} onClick={() => setActive("view")}>
                {t.viewer.thumb}
              </button>
            )}
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

        {variants && variants.length > 1 && (
          <div className="pd__variant" role="group" aria-label={t.viewer.colour}>
            <p className="eyebrow">{t.viewer.colour}</p>
            <div className="pd__colours">
              {variants.map((vr, i) => (
                <button key={vr.name} type="button" className="pd__colour" aria-pressed={i === variantIndex} onClick={() => setVariantIndex(i)}>
                  {(locale !== "en" && vr.labels?.[locale]) || vr.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {item.showcase ? (
          <div className="notice">
            <p>
              <strong>{t.showcase.notForSale}</strong>{" "}
              {fmt(t.showcase.credit, { type: t.showcase.types[item.showcase.type] ?? "", source: item.showcase.source, author: item.showcase.author, licence: item.showcase.licence })}{" "}
              <a href={item.showcase.sourceUrl} target="_blank" rel="noopener noreferrer">
                {item.showcase.source}
              </a>
            </p>
          </div>
        ) : (
          preview && (
            <div className="notice">
              <p>
                <strong>{p.previewStrong}</strong> {item.editorialNote ?? p.previewDefault} {p.previewTail}
              </p>
            </div>
          )
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
