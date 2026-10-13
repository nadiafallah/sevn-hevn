"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { brandById, type BrandId } from "@/data/brands";
import { categories, type CategoryId } from "@/data/taxonomy";
import { useI18n } from "@/i18n/I18nProvider";
import { track } from "@/lib/analytics";
import { formatAED } from "@/lib/format";
import { categoryPath } from "@/lib/paths";
import { FILTER_PARAMS, PARAM, facets, listing, offers, readListing, setParam, sortIds, type ListingState, type Option } from "@/lib/shop";
import { generalMessage, whatsappUrl } from "@/lib/whatsapp";
import { Dialog } from "./Dialog";
import { ItemCard } from "./ItemCard";
import { useSite } from "./SiteProvider";
import { CloseIcon, FilterIcon, SearchIcon, WhatsAppIcon } from "./icons";

type Mode = "push" | "replace";

/**
 * A listing: a category (/bags), a category and house (/bags/hermes), or every category
 * (/collection, where search results land). Every choice is kept in the address, so a link can be
 * shared and the browser's Back button steps back through filter changes.
 */
export function ListingView({ category, brand }: { category?: CategoryId; brand?: BrandId }) {
  const params = useSearchParams();
  const { items, openPanel } = useSite();
  const { t, href, fmt, plural, locale } = useI18n();
  const s = t.shop;
  const L = s.listing;
  const state = readListing(new URLSearchParams(params.toString()), { category, brand });
  const searchId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Inside the filter panel, the first change adds one history entry and later ones update it.
  const [pushedInPanel, setPushedInPanel] = useState(false);

  const extra = useMemo(() => (i: (typeof items)[number]) => [t.categories[i.category], i.subcategory ? (s.types[i.subcategory] ?? "") : ""], [t.categories, s.types]);
  const { scoped, results } = useMemo(() => listing(items, state, extra), [items, state, extra]);
  // Houses and categories are offered from what the page is about, before narrowing by house.
  const houseScope = useMemo(() => items.filter((i) => !state.category || i.category === state.category), [items, state.category]);
  const houses = useMemo(() => facets(houseScope).brands, [houseScope]);
  const f = useMemo(() => facets(scoped, state.category), [scoped, state.category]);
  const collection = !category;

  function navigate(mutate: (p: URLSearchParams) => void, mode: Mode = "push") {
    const next = new URLSearchParams(window.location.search);
    mutate(next);
    const qs = next.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    // A fresh state object: reusing Next.js's own history state would skip its URL sync.
    if (mode === "push") window.history.pushState({ sevnListing: true }, "", url);
    else window.history.replaceState({ sevnListing: true }, "", url);
  }

  function panelMode(): Mode {
    if (!filtersOpen) return "push";
    if (!pushedInPanel) setPushedInPanel(true);
    return pushedInPanel ? "replace" : "push";
  }

  function setFilter(key: string, value: string | string[] | number | undefined) {
    navigate((p) => setParam(p, key, value), panelMode());
    track("filter_change", { filter: key });
  }

  function toggleIn(key: keyof Pick<ListingState, "colour" | "availability" | "size" | "caseSize" | "metal">, id: string) {
    const cur = state[key] as string[];
    setFilter(PARAM[key], cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  function clearAll() {
    setQuery("");
    navigate((p) => [...FILTER_PARAMS, PARAM.q, ...(collection ? [PARAM.brand] : [])].forEach((k) => p.delete(k)));
  }

  // Search box (Collection): typing updates the address without adding history entries.
  const [query, setQuery] = useState(state.q);
  const [prevQ, setPrevQ] = useState(state.q);
  if (state.q !== prevQ) {
    setPrevQ(state.q);
    setQuery(state.q);
  }
  useEffect(() => {
    if (query === state.q) return;
    const timer = setTimeout(() => {
      navigate((p) => setParam(p, PARAM.q, query.trim()), "replace");
      if (query.trim()) track("search", { length: query.trim().length });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, state.q]);

  useEffect(() => {
    track("collection_view");
  }, []);

  const categoryLabel = state.category ? t.categories[state.category] : undefined;
  const brandName = state.brand ? brandById[state.brand].name : undefined;
  const title = brandName && categoryLabel ? fmt(L.brandCategory, { brand: brandName, category: categoryLabel }) : (categoryLabel ?? brandName ?? s.allPieces);
  const count = plural(results.length, L.count);

  // Active filters, each removable on its own.
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(!collection && state.q ? [{ key: "q", label: `“${state.q}”`, remove: () => setFilter(PARAM.q, undefined) }] : []),
    ...(state.type ? [{ key: "type", label: s.types[state.type] ?? state.type, remove: () => setFilter(PARAM.type, undefined) }] : []),
    ...(collection && state.brand ? [{ key: "brand", label: brandName!, remove: () => setFilter(PARAM.brand, undefined) }] : []),
    ...state.colour.map((c) => ({ key: `c-${c}`, label: f.colour.find((o) => o.id === c)?.label ?? c, remove: () => toggleIn("colour", c) })),
    ...state.availability.map((a) => ({ key: `a-${a}`, label: s.availability[a], remove: () => toggleIn("availability", a) })),
    ...state.size.map((z) => ({ key: `s-${z}`, label: `${L.groups.size} ${f.size.find((o) => o.id === z)?.label ?? z}`, remove: () => toggleIn("size", z) })),
    ...state.caseSize.map((z) => ({ key: `k-${z}`, label: fmt(L.mm, { n: z }), remove: () => toggleIn("caseSize", z) })),
    ...state.metal.map((m) => ({ key: `m-${m}`, label: f.metal.find((o) => o.id === m)?.label ?? m, remove: () => toggleIn("metal", m) })),
    ...(state.priceMin !== undefined || state.priceMax !== undefined
      ? [
          {
            key: "price",
            label: [state.priceMin !== undefined ? formatAED(state.priceMin) : "", state.priceMax !== undefined ? formatAED(state.priceMax) : ""].join(" – "),
            remove: () => navigate((p) => [PARAM.priceMin, PARAM.priceMax].forEach((k) => p.delete(k))),
          },
        ]
      : []),
  ];
  const filterCount = chips.length;
  const groups = {
    colour: offers(f.colour, state.colour),
    availability: offers(f.availability, state.availability),
    size: offers(f.size, state.size),
    caseSize: offers(f.caseSize, state.caseSize),
    metal: offers(f.metal, state.metal),
    price: f.priced >= 2 || state.priceMin !== undefined || state.priceMax !== undefined,
  };
  const hasFilters = Object.values(groups).some(Boolean);
  const request = () => openPanel({ type: "sourcing", prefill: { category: state.category, brand: brandName, details: state.q || undefined } });

  return (
    <>
      <div className="listing-head container">
        <nav aria-label={s.shop} className="crumbs">
          <ol>
            <li>
              <Link href={href("/")}>{s.home}</Link>
            </li>
            {state.category && (
              <li>
                {brandName ? <Link href={href(categoryPath(state.category))}>{categoryLabel}</Link> : <span aria-current="page">{categoryLabel}</span>}
              </li>
            )}
            {!state.category && (
              <li>
                <span aria-current="page">{s.allPieces}</span>
              </li>
            )}
            {brandName && state.category && (
              <li>
                <span aria-current="page" lang="en" dir="ltr">
                  {brandName}
                </span>
              </li>
            )}
          </ol>
        </nav>
        <h1 className="display display--sm listing-head__title">{title}</h1>
        {state.category && !brandName && <p className="listing-head__intro">{L.categoryIntro[state.category]}</p>}
      </div>

      <div className="listing-bar">
        <div className="container">
          {collection && (
            <ChipRow label={t.nav.categories}>
              <Link className="chip" href={href(`/collection${state.q ? `?q=${encodeURIComponent(state.q)}` : ""}`)} aria-current="page">
                {L.all}
              </Link>
              {categories.map((c) => (
                <Link key={c.id} className="chip" href={href(`${categoryPath(c.id)}${state.q ? `?q=${encodeURIComponent(state.q)}` : ""}`)}>
                  {t.categories[c.id]}
                </Link>
              ))}
            </ChipRow>
          )}

          {houses.length > 0 && (
            <ChipRow label={L.houses}>
              {collection ? (
                <ChipLink active={!state.brand} onClick={() => setFilter(PARAM.brand, undefined)}>
                  {L.all}
                </ChipLink>
              ) : (
                <Link className="chip" href={href(categoryPath(category!))} aria-current={!brand ? "page" : undefined}>
                  {L.all}
                </Link>
              )}
              {houses.map((b) =>
                collection ? (
                  <ChipLink key={b.id} active={state.brand === b.id} onClick={() => setFilter(PARAM.brand, b.id)} lang="en">
                    {b.label}
                  </ChipLink>
                ) : (
                  <Link key={b.id} className="chip" href={href(categoryPath(category!, b.id))} aria-current={brand === b.id ? "page" : undefined} lang="en" dir="ltr">
                    {b.label}
                  </Link>
                ),
              )}
            </ChipRow>
          )}

          {state.category && offers(f.types, state.type ? [state.type] : []) && (
            <ChipRow label={L.groups.type}>
              <ChipLink active={!state.type} onClick={() => setFilter(PARAM.type, undefined)}>
                {L.all}
              </ChipLink>
              {f.types.map((ty) => (
                <ChipLink key={ty.id} active={state.type === ty.id} onClick={() => setFilter(PARAM.type, ty.id)}>
                  {s.types[ty.id] ?? ty.label}
                </ChipLink>
              ))}
            </ChipRow>
          )}

          <div className="listing-tools">
            {collection && (
              <form role="search" className="listing-search" onSubmit={(e) => e.preventDefault()}>
                <label htmlFor={searchId} className="visually-hidden">
                  {t.panels.searchLabel}
                </label>
                <SearchIcon size={18} />
                <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s.search.placeholder} maxLength={80} enterKeyHint="search" dir="auto" />
              </form>
            )}
            <p className="listing-tools__count" aria-live="polite">
              {state.q ? fmt(L.resultsFor, { results: count, query: state.q }) : count}
            </p>
            <div className="listing-tools__end">
              {hasFilters && (
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => {
                    setPushedInPanel(false);
                    setFiltersOpen(true);
                  }}
                  aria-haspopup="dialog"
                >
                  <FilterIcon size={17} /> {L.filter}
                  {filterCount > 0 && <span className="tool-btn__count">{filterCount}</span>}
                </button>
              )}
              <label className="tool-select">
                <span className="visually-hidden">{L.sort}</span>
                <select value={state.sort} onChange={(e) => setFilter(PARAM.sort, e.target.value === "newest" ? undefined : e.target.value)}>
                  {sortIds
                    .filter((id) => id === "newest" || f.priced >= 2)
                    .map((id) => (
                      <option key={id} value={id}>
                        {L.sort}: {L.sorts[id]}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </div>

          {(chips.length > 0 || (collection && state.q)) && (
            <div className="active-filters">
              {chips.map((c) => (
                <button key={c.key} type="button" className="chip chip--active" onClick={c.remove} aria-label={fmt(L.remove, { label: c.label })}>
                  {c.label} <CloseIcon size={12} />
                </button>
              ))}
              <button type="button" className="link-btn small" onClick={clearAll}>
                {L.clearAll}
              </button>
            </div>
          )}
          {(state.priceMin !== undefined || state.priceMax !== undefined) && <p className="muted small listing-note">{L.priceNote}</p>}
        </div>
      </div>

      <section className="container listing-results" aria-label={count}>
        {results.length > 0 ? (
          <div className="grid grid--shop">
            {results.map((item, i) => (
              <ItemCard key={item.ref} item={item} priority={i < 4} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <h2 className="h3">
              {scoped.length === 0 && !state.q
                ? brandName && state.category
                  ? fmt(L.emptyBrand, { brand: brandName, category: (categoryLabel ?? "").toLocaleLowerCase(locale) })
                  : state.category
                    ? L.emptyCategory[state.category]
                    : L.emptyTitle
                : L.emptyTitle}
            </h2>
            <p>{scoped.length === 0 && !state.q ? L.emptyRequest : L.emptyText}</p>
            <div className="stack-actions">
              <button type="button" className="btn btn--dark" onClick={request}>
                {L.request}
              </button>
              <a className="btn btn--line" href={whatsappUrl(generalMessage(t.messages))} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click", { source: "listing-empty" })}>
                <WhatsAppIcon size={18} /> {t.footer.whatsapp}
              </a>
              {(chips.length > 0 || state.q) && (
                <button type="button" className="btn btn--line" onClick={clearAll}>
                  {L.clearFilters}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title={L.filters} variant="drawer" footer={
        <div className="filters__foot">
          <button type="button" className="btn btn--line" onClick={clearAll} disabled={chips.length === 0}>
            {L.clearAll}
          </button>
          <button type="button" className="btn btn--dark" onClick={() => setFiltersOpen(false)}>
            {plural(results.length, L.show)}
          </button>
        </div>
      }>
        <div className="filters">
          {groups.availability && (
            <CheckGroup legend={L.groups.availability} options={f.availability.map((o) => ({ ...o, label: s.availability[o.id] }))} selected={state.availability} onToggle={(id) => toggleIn("availability", id)} />
          )}
          {groups.price && (
            <PriceGroup
              key={`${state.priceMin ?? ""}-${state.priceMax ?? ""}`}
              legend={L.groups.price}
              min={state.priceMin}
              max={state.priceMax}
              bounds={f.priceBounds}
              labels={{ min: L.min, max: L.max }}
              onCommit={(min, max) => navigate((p) => (setParam(p, PARAM.priceMin, min), setParam(p, PARAM.priceMax, max)), panelMode())}
            />
          )}
          {groups.colour && <CheckGroup legend={L.groups.colour} options={f.colour} selected={state.colour} onToggle={(id) => toggleIn("colour", id)} />}
          {groups.size && <CheckGroup legend={L.groups.size} options={f.size} selected={state.size} onToggle={(id) => toggleIn("size", id)} />}
          {groups.caseSize && (
            <CheckGroup legend={L.groups.caseSize} options={f.caseSize.map((o) => ({ ...o, label: fmt(L.mm, { n: o.label }) }))} selected={state.caseSize} onToggle={(id) => toggleIn("caseSize", id)} />
          )}
          {groups.metal && <CheckGroup legend={L.groups.metal} options={f.metal} selected={state.metal} onToggle={(id) => toggleIn("metal", id)} />}
        </div>
      </Dialog>
    </>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function ChipLink({ active, onClick, children, lang }: { active: boolean; onClick: () => void; children: ReactNode; lang?: string }) {
  return (
    <button type="button" className="chip" aria-pressed={active} onClick={onClick} lang={lang}>
      {children}
    </button>
  );
}

function CheckGroup({ legend, options, selected, onToggle }: { legend: string; options: Option[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <fieldset className="filter-group">
      <legend>{legend}</legend>
      <ul>
        {options.map((o) => (
          <li key={o.id}>
            <label className="check">
              <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
              <span>{o.label}</span>
              <span className="check__count">{o.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function PriceGroup({
  legend,
  min,
  max,
  bounds,
  labels,
  onCommit,
}: {
  legend: string;
  min?: number;
  max?: number;
  bounds?: { min: number; max: number };
  labels: { min: string; max: string };
  onCommit: (min?: number, max?: number) => void;
}) {
  const [lo, setLo] = useState(min?.toString() ?? "");
  const [hi, setHi] = useState(max?.toString() ?? "");
  const num = (v: string) => {
    const n = Number(v.replace(/[^\d]/g, ""));
    return v.trim() && n > 0 ? n : undefined;
  };
  const commit = () => {
    const a = num(lo);
    const b = num(hi);
    if (a !== min || b !== max) onCommit(a !== undefined && b !== undefined && a > b ? b : a, a !== undefined && b !== undefined && a > b ? a : b);
  };
  return (
    <fieldset className="filter-group">
      <legend>{legend}</legend>
      <div className="price-range">
        <label>
          <span>{labels.min}</span>
          <input inputMode="numeric" value={lo} onChange={(e) => setLo(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} placeholder={bounds ? String(bounds.min) : ""} dir="ltr" />
        </label>
        <span aria-hidden="true">–</span>
        <label>
          <span>{labels.max}</span>
          <input inputMode="numeric" value={hi} onChange={(e) => setHi(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} placeholder={bounds ? String(bounds.max) : ""} dir="ltr" />
        </label>
      </div>
    </fieldset>
  );
}
