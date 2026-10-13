"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { site } from "@/config/site";
import type { Item, Variant } from "@/data/types";
import { useI18n } from "@/i18n/I18nProvider";
import { findVariant, isPurchasable, priceLabel, unitStock } from "@/lib/format";
import { categoryPath, type ShopItem } from "@/lib/paths";
import { availabilityOf } from "@/lib/shop";
import { itemMessage, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { useSite } from "./SiteProvider";
import { ItemBadge, ItemCard, frameFit } from "./ItemCard";
import { Dialog } from "./Dialog";
import { ArrowIcon, PhoneIcon, WhatsAppIcon, ZoomIcon } from "./icons";

type Dim = "colour" | "size" | "hardware" | "material";
const DIMS: Dim[] = ["colour", "size", "hardware", "material"];
type Choice = Partial<Record<Dim, string>>;

/** Option groups a piece really has: a group appears only when its versions differ in it. */
function optionGroups(variants: Variant[]) {
  return DIMS.map((dim) => ({ dim, values: Array.from(new Set(variants.map((v) => v[dim]).filter((x): x is string => !!x))) })).filter((g) => g.values.length > 1);
}

function matching(variants: Variant[], choice: Choice, except?: Dim) {
  return variants.filter((v) => DIMS.every((d) => d === except || !choice[d] || v[d] === choice[d]));
}

export function ProductDetail({ item, related, initialSku }: { item: Item; related: ShopItem[]; initialSku?: string }) {
  const { cart, openPanel } = useSite();
  const { t, locale, fmt, href } = useI18n();
  const s = t.shop;
  const p = s.product;
  const variants = useMemo(() => item.variants ?? [], [item.variants]);
  const groups = useMemo(() => optionGroups(variants), [variants]);

  // Start from a shared ?sku= link, or the first version's colour (so photo and price match it).
  const [choice, setChoice] = useState<Choice>(() => {
    const fromLink = findVariant(item, initialSku);
    const base = fromLink ?? variants[0];
    if (!base) return {};
    if (fromLink) return Object.fromEntries(DIMS.map((d) => [d, base[d]]).filter(([, v]) => v)) as Choice;
    return groups.some((g) => g.dim === "colour") && base.colour ? { colour: base.colour } : {};
  });
  const candidates = matching(variants, choice);
  const complete = groups.every((g) => choice[g.dim]);
  const variant = variants.length === 1 ? variants[0] : complete ? candidates[0] : undefined;

  const [active, setActive] = useState(variant?.imageIndex ?? 0);
  const [prevVariant, setPrevVariant] = useState(variant?.sku);
  if (variant?.sku !== prevVariant) {
    setPrevVariant(variant?.sku);
    if (variant?.imageIndex !== undefined) setActive(variant.imageIndex);
  }
  const [zoom, setZoom] = useState<number | null>(null);

  // Keep the chosen version in the address so the link can be shared.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (variant) url.searchParams.set("sku", variant.sku);
    else url.searchParams.delete("sku");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [variant]);

  useEffect(() => {
    track("product_view", { ref: item.ref, status: item.status });
  }, [item.ref, item.status]);

  const availability = availabilityOf(item);
  // A piece with versions is bought as one of them: only once a version is chosen.
  const buyable = isPurchasable(item, variant) && (variants.length === 0 || !!variant);
  const needsChoice = item.status === "available" && !item.draft && variants.length > 1 && !variant && isPurchasable(item);
  const inBag = cart.has(item.ref, variant?.sku);
  const title = `${item.brand ?? ""} ${item.name}`.trim();
  const image = item.images[active] ?? item.images[0];
  const firstMissing = groups.find((g) => !choice[g.dim]);

  const optionText = variant ? DIMS.map((d) => variant[d]).filter(Boolean).join(" · ") : "";
  // The piece's own colour / size / hardware when it has no versions to choose from.
  const ownDetails = [item.colour, item.size ? (item.sizeSystem ? `${item.sizeSystem} ${item.size}` : item.size) : undefined, item.hardware].filter(Boolean).join(" · ");
  const waHref = whatsappUrl(itemMessage(item, t.messages, locale, { variant, details: variants.length ? undefined : ownDetails, price: priceLabel(item, t.price, variant) }));
  const sourcing = () =>
    openPanel({
      type: "sourcing",
      prefill: { category: item.category, brand: item.brand, model: item.name, details: [item.modelReference, optionText].filter(Boolean).join(" · ") || undefined, relatedRef: item.ref },
    });

  const v = (d: Dim) => variant?.[d] ?? (d === "colour" ? item.colour : d === "size" ? item.size : d === "hardware" ? item.hardware : item.material);
  const sizeLabel = item.sizeSystem ? fmt(p.specs.sizeIn, { system: item.sizeSystem }) : p.specs.size;
  const typeLabel = item.subcategory ? (s.types[item.subcategory] ?? item.subcategory) : undefined;
  const byCategory: Record<Item["category"], [string, string | undefined][]> = {
    bags: [[p.specs.dimensions, item.dimensions], [p.specs.colour, v("colour")], [p.specs.material, v("material")], [p.specs.hardware, v("hardware")], [p.specs.size, v("size")]],
    shoes: [[sizeLabel, v("size")], [p.specs.colour, v("colour")], [p.specs.material, v("material")], [p.specs.hardware, v("hardware")]],
    watches: [
      [p.specs.reference, item.modelReference],
      [p.specs.caseSize, item.caseDiameterMm ? fmt(s.listing.mm, { n: item.caseDiameterMm }) : undefined],
      [p.specs.material, v("material")],
      [p.specs.movement, item.movement ? s.movements[item.movement] : undefined],
      [p.specs.colour, v("colour")],
      [p.specs.audience, item.audience ? s.audiences[item.audience] : undefined],
    ],
    jewellery: [[p.specs.metal, v("material")], [p.specs.purity, item.purity], [p.specs.stones, item.stones], [p.specs.size, v("size")], [p.specs.colour, v("colour")]],
  };
  const specs: [string, string | undefined][] = [
    [p.specs.house, item.brand],
    [p.specs.type, typeLabel],
    ...(item.category !== "watches" ? ([[p.specs.reference, item.modelReference]] as [string, string | undefined][]) : []),
    ...byCategory[item.category],
    [p.specs.year, item.year],
  ];
  const condition: [string, string | undefined][] = [
    [p.specs.condition, item.condition ? t.conditions[item.condition] : undefined],
    [p.specs.conditionNotes, item.conditionNotes],
    [p.specs.included, item.included?.length ? item.included.join(", ") : undefined],
  ];
  const statusText = item.draft ? undefined : p.status[availability];

  return (
    <>
      <div className="container pdp">
        <nav aria-label={s.shop} className="crumbs">
          <ol>
            <li>
              <Link href={href("/")}>{s.home}</Link>
            </li>
            <li>
              <Link href={href(categoryPath(item.category))}>{t.categories[item.category]}</Link>
            </li>
            {item.brandId && (
              <li>
                <Link href={href(categoryPath(item.category, item.brandId))} lang="en" dir="ltr">
                  {item.brand}
                </Link>
              </li>
            )}
            <li>
              <span aria-current="page">{item.name}</span>
            </li>
          </ol>
        </nav>

        <div className="pdp__grid">
          <section className="pdp-gallery" aria-label={fmt(p.gallery.label, { name: title })}>
            {image && (
              <button type="button" className={`pdp-gallery__main pdp-gallery__main--${frameFit(image)}`} onClick={() => setZoom(active)} aria-label={fmt(p.gallery.zoom, { n: active + 1, total: item.images.length })}>
                <Image key={image.src} src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(min-width: 1000px) 52vw, 100vw" priority className="pdp-gallery__img" />
                <span className="pdp-gallery__zoom" aria-hidden="true">
                  <ZoomIcon size={18} />
                </span>
              </button>
            )}
            {item.images.length > 1 && (
              <div className="pdp-gallery__thumbs" role="group" aria-label={t.product.chooseImage}>
                {item.images.map((im, i) => (
                  <button key={im.src} type="button" className="pdp-gallery__thumb" aria-pressed={i === active} aria-label={fmt(t.product.imageOf, { n: i + 1, total: item.images.length })} onClick={() => setActive(i)}>
                    <Image src={im.src} alt="" width={im.width} height={im.height} sizes="88px" className={`pdp-gallery__thumb-img--${frameFit(im)}`} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="pdp-info">
            <div className="pdp-info__badges">
              <ItemBadge item={item} />
            </div>
            {item.brand && (
              <p className="pdp-info__brand" lang="en" dir="ltr">
                {item.brandId ? <Link href={href(categoryPath(item.category, item.brandId))}>{item.brand}</Link> : item.brand}
              </p>
            )}
            <h1 className="pdp-info__name">{item.name}</h1>
            <p className="pdp-info__code">
              {p.code} <bdi dir="ltr">{item.ref}</bdi>
              {variant && variants.length > 1 && (
                <>
                  {" · "}
                  {p.versionCode} <bdi dir="ltr">{variant.sku}</bdi>
                </>
              )}
            </p>
            <p className="pdp-info__price">{priceLabel(item, t.price, variant)}</p>
            {statusText && <p className={`pdp-info__status pdp-info__status--${availability}`}>{statusText}</p>}

            {item.draft && (
              <div className="notice notice--draft" role="note">
                <p>
                  <strong>{p.draftStrong}</strong> {p.draftText}
                  {item.draftNote && <> {item.draftNote}</>}
                </p>
              </div>
            )}

            {groups.map((g) => {
              const label = p.options[g.dim];
              return (
                <fieldset key={g.dim} className="pdp-option">
                  <legend>
                    {label}
                    {choice[g.dim] && <span className="pdp-option__value">: {choice[g.dim]}</span>}
                  </legend>
                  <div className="pdp-option__values">
                    {g.values.map((value) => {
                      const possible = matching(variants, { ...choice, [g.dim]: value }, undefined);
                      const unavailable = item.status === "available" && !possible.some((x) => (unitStock(item, x) ?? 0) > 0);
                      return (
                        <button
                          key={value}
                          type="button"
                          className="opt"
                          aria-pressed={choice[g.dim] === value}
                          aria-label={unavailable ? fmt(p.optionUnavailable, { value }) : value}
                          data-unavailable={unavailable || undefined}
                          onClick={() =>
                            setChoice((c) => {
                              const next: Choice = { ...c, [g.dim]: c[g.dim] === value ? undefined : value };
                              // Drop choices that no longer combine with the new one.
                              for (const d of DIMS) if (d !== g.dim && next[d] && !matching(variants, next).length) next[d] = undefined;
                              // A choice that leaves a single version selects it completely.
                              const only = matching(variants, next);
                              if (next[g.dim] && only.length === 1) for (const d of DIMS) if (only[0][d]) next[d] = only[0][d];
                              return next;
                            })
                          }
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}

            {item.description && <p className="pdp-info__desc">{item.description}</p>}

            <div className="pdp-actions">
              {buyable && (
                <button
                  type="button"
                  className="btn btn--dark btn--block"
                  onClick={() => {
                    if (!inBag) cart.add(item.ref, variant?.sku);
                    openPanel({ type: "cart" });
                  }}
                >
                  {inBag ? `${p.inBag} — ${p.viewBag}` : p.addToBag}
                </button>
              )}
              {needsChoice && (
                <>
                  <button type="button" className="btn btn--dark btn--block" disabled aria-describedby="pdp-choose">
                    {p.addToBag}
                  </button>
                  <p id="pdp-choose" className="muted small">
                    {fmt(p.chooseFirst, { option: firstMissing ? p.options[firstMissing.dim].toLocaleLowerCase(locale) : "" })}
                  </p>
                </>
              )}
              {item.status === "sold" || item.status === "reserved" ? (
                <>
                  <button type="button" className="btn btn--dark btn--block" onClick={sourcing}>
                    {p.requestSimilar}
                  </button>
                  <a className="btn btn--line btn--block" href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "item", ref: item.ref })}>
                    <WhatsAppIcon size={18} /> {p.enquireWhatsApp}
                  </a>
                </>
              ) : (
                <>
                  <a
                    className={`btn btn--block ${buyable || needsChoice ? "btn--line" : "btn--dark"}`}
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track("whatsapp_click", { source: "item", ref: item.ref })}
                  >
                    <WhatsAppIcon size={18} /> {p.enquireWhatsApp}
                  </a>
                  {!buyable && !needsChoice && (
                    <button type="button" className="btn btn--line btn--block" onClick={sourcing}>
                      {p.requestAvailability}
                    </button>
                  )}
                </>
              )}
              <button type="button" className="link-btn small pdp-actions__viewing" onClick={() => openPanel({ type: "viewing", prefill: { interest: title, relatedRef: item.ref } })}>
                {p.arrangeViewing}
              </button>
            </div>

            <div className="pdp-sections">
              <details open>
                <summary>{p.details}</summary>
                <Specs rows={specs} />
              </details>
              {condition.some(([, x]) => x) && (
                <details>
                  <summary>{p.conditionTitle}</summary>
                  <Specs rows={condition} />
                </details>
              )}
              <details>
                <summary>{p.authenticityTitle}</summary>
                <p>{item.authentication ?? p.authenticityNone}</p>
                {item.brand && <p className="muted small">{fmt(p.reseller, { brand: item.brand })}</p>}
              </details>
              <details>
                <summary>{p.deliveryTitle}</summary>
                <p>{item.delivery ?? p.deliveryDefault}</p>
                <p>{item.returns ?? p.returnsDefault}</p>
                {buyable && <p className="muted small">{p.notReserved}</p>}
                <p>
                  <button type="button" className="link-btn small" onClick={() => openPanel({ type: "policy", id: "shipping" })}>
                    {p.policies}
                  </button>
                </p>
              </details>
            </div>

            <p className="pdp-info__alt">
              <PhoneIcon size={16} /> {t.product.preferTalk}{" "}
              <a href={site.contact.telHref} dir="ltr">
                {site.contact.phoneDisplay}
              </a>{" "}
              · <a href={site.contact.emailHref}>{t.product.email}</a>
            </p>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="container section related" aria-labelledby="related-title">
          <div className="section__head">
            <h2 id="related-title" className="h2">
              {p.related}
            </h2>
            <Link href={href(categoryPath(item.category))} className="text-link">
              {fmt(s.menu.shopAll, { category: t.categories[item.category] })} <ArrowIcon size={14} />
            </Link>
          </div>
          <div className="grid grid--shop">
            {related.map((r) => (
              <ItemCard key={r.ref} item={r} />
            ))}
          </div>
        </section>
      )}

      <Dialog open={zoom !== null} onClose={() => setZoom(null)} title={fmt(p.gallery.label, { name: title })} variant="zoom" hideTitle>
        {zoom !== null && <Zoom images={item.images} index={zoom} onIndex={setZoom} labels={p.gallery} total={item.images.length} fmtZoom={(n) => fmt(t.product.imageOf, { n, total: item.images.length })} />}
      </Dialog>
    </>
  );
}

function Specs({ rows }: { rows: [string, string | undefined][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <dl className="specs">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Full-screen photos: arrows or buttons to move between them; Zoom shows the photo at full size to pan around. */
function Zoom({
  images,
  index,
  onIndex,
  labels,
  total,
  fmtZoom,
}: {
  images: Item["images"];
  index: number;
  onIndex: (i: number) => void;
  labels: { previous: string; next: string; zoomIn: string; zoomOut: string };
  total: number;
  fmtZoom: (n: number) => string;
}) {
  const [big, setBig] = useState(false);
  const image = images[index];
  const go = (d: number) => {
    setBig(false);
    onIndex((index + d + total) % total);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (total < 2) return;
      const rtl = document.documentElement.dir === "rtl";
      if (e.key === "ArrowRight") go(rtl ? -1 : 1);
      if (e.key === "ArrowLeft") go(rtl ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!image) return null;
  return (
    <div className="zoom">
      <div className={`zoom__stage${big ? " zoom__stage--big" : ""}`}>
        <Image src={image.src} alt={image.alt} width={image.width} height={image.height} sizes={big ? "200vw" : "100vw"} quality={85} className="zoom__img" onClick={() => setBig((b) => !b)} />
      </div>
      <div className="zoom__bar">
        {total > 1 && (
          <button type="button" className="btn btn--line" onClick={() => go(-1)}>
            {labels.previous}
          </button>
        )}
        <span className="muted small" aria-live="polite">
          {fmtZoom(index + 1)}
        </span>
        <button type="button" className="btn btn--line" onClick={() => setBig((b) => !b)} aria-pressed={big}>
          {big ? labels.zoomOut : labels.zoomIn}
        </button>
        {total > 1 && (
          <button type="button" className="btn btn--line" onClick={() => go(1)}>
            {labels.next}
          </button>
        )}
      </div>
    </div>
  );
}
