"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Item } from "@/data/types";
import { categories, isCategoryId } from "@/data/taxonomy";
import { useI18n } from "@/i18n/I18nProvider";
import { rich } from "@/i18n/rich";
import type { Plural } from "@/i18n/format";
import { formatAED } from "@/lib/format";
import { track } from "@/lib/analytics";
import { ItemCard } from "./ItemCard";
import { Dialog } from "./Dialog";
import { ProductDetail } from "./ProductDetail";
import { useSite } from "./SiteProvider";
import { SearchIcon } from "./icons";

// Amounts read the same in every language ("AED 20,000"); only the words around them are translated.
const PRICE_BANDS = [
  { id: "under-20k", kind: "under", a: 20_000, test: (p: number) => p < 20_000 },
  { id: "20k-50k", kind: "between", a: 20_000, b: 50_000, test: (p: number) => p >= 20_000 && p < 50_000 },
  { id: "50k-100k", kind: "between", a: 50_000, b: 100_000, test: (p: number) => p >= 50_000 && p < 100_000 },
  { id: "100k-plus", kind: "above", a: 100_000, test: (p: number) => p >= 100_000 },
] as const;

const FILTER_KEYS = ["category", "designer", "availability", "condition", "price"] as const;

type Words = { results: Plural; previews: Plural; resultsBoth: string };

/** Editorial previews are not for sale, so they are never counted as "pieces". */
function resultCount(list: Item[], w: Words, plural: (n: number, forms: Plural) => string) {
  const previews = list.filter((i) => i.status === "editorial_preview").length;
  const pieces = list.length - previews;
  if (previews === 0) return plural(pieces, w.results);
  const p = plural(previews, w.previews);
  return pieces === 0 ? p : w.resultsBoth.replace("{pieces}", plural(pieces, w.results)).replace("{previews}", p);
}
type FilterKey = (typeof FILTER_KEYS)[number];

function normalise(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Searchable text: the shown wording, the English wording (searchText) and the category name. */
function haystack(item: Item, categoryName?: string) {
  return normalise(
    [item.name, item.brand, item.modelReference, item.ref, item.colour, item.material, item.subcategory, categoryName, item.category, item.description, item.searchText].filter(Boolean).join(" "),
  );
}

export function CollectionView({ items }: { items: Item[] }) {
  const params = useSearchParams();
  const { openPanel } = useSite();
  const { t, fmt, plural } = useI18n();
  const c = t.collection;
  const searchId = useId();
  const resultsRef = useRef<HTMLParagraphElement>(null);

  const q = params.get("q") ?? "";
  const selected: Record<FilterKey, string> = {
    category: params.get("category") ?? "",
    designer: params.get("designer") ?? "",
    availability: params.get("availability") ?? "",
    condition: params.get("condition") ?? "",
    price: params.get("price") ?? "",
  };
  const sort = params.get("sort") ?? "";
  const itemRef = params.get("item");
  const openItem = itemRef ? items.find((i) => i.ref.toUpperCase() === itemRef.toUpperCase()) : undefined;

  // Local mirror of the search box so typing stays responsive; the URL is updated with replaceState.
  const [query, setQuery] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setQuery(q);
  }

  const navigate = useCallback(
    (mutate: (p: URLSearchParams) => void, mode: "push" | "replace" = "push", state?: object) => {
      const next = new URLSearchParams(window.location.search);
      mutate(next);
      const qs = next.toString();
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (mode === "push") window.history.pushState(state ?? null, "", url);
      // Pass a fresh state object: reusing Next.js's own history state would skip its URL sync.
      else window.history.replaceState(state ?? null, "", url);
    },
    [],
  );

  // Options come from real data only; a filter appears when it can actually narrow results.
  const options = useMemo(() => {
    const uniq = <T,>(arr: (T | undefined)[]) => Array.from(new Set(arr.filter(Boolean) as T[]));
    const priced = items.filter((i) => i.priceAED && i.status !== "editorial_preview");
    return {
      designer: uniq(items.map((i) => i.brand))
        .sort()
        .map((b) => ({ id: b, label: b })),
      availability: uniq(items.map((i) => i.status)).map((s) => ({ id: s, label: t.statuses[s] })),
      condition: uniq(items.map((i) => i.condition)).map((k) => ({ id: k, label: t.conditions[k] })),
      price:
        priced.length >= 2
          ? PRICE_BANDS.filter((b) => priced.some((i) => b.test(i.priceAED!))).map((b) => ({
              id: b.id,
              label: fmt(c.priceBands[b.kind], { a: formatAED(b.a), b: "b" in b ? b.b.toLocaleString("en-US") : "" }),
            }))
          : [],
    };
  }, [items, t, c, fmt]);

  const hasPrices = options.price.length > 0;

  const results = useMemo(() => {
    const terms = normalise(query.trim()).split(/\s+/).filter(Boolean);
    const band = PRICE_BANDS.find((b) => b.id === selected.price);
    const list = items.filter((i) => {
      if (selected.category && i.category !== selected.category) return false;
      if (selected.designer && i.brand !== selected.designer) return false;
      if (selected.availability && i.status !== selected.availability) return false;
      if (selected.condition && i.condition !== selected.condition) return false;
      if (band && !(i.priceAED && band.test(i.priceAED))) return false;
      if (terms.length) {
        const h = haystack(i, isCategoryId(i.category) ? t.categories[i.category] : undefined);
        if (!terms.every((t) => h.includes(t))) return false;
      }
      return true;
    });
    // Genuine listings first, then editorial previews.
    const rank = (i: Item) => (i.status === "available" ? 0 : i.status === "enquiry_only" ? 1 : i.status === "reserved" ? 2 : i.status === "sold" ? 3 : 4);
    return [...list].sort((a, b) => {
      if (sort === "price-asc" || sort === "price-desc") {
        // Unpriced pieces always sort last.
        const pa = a.priceAED;
        const pb = b.priceAED;
        if (pa === undefined && pb !== undefined) return 1;
        if (pb === undefined && pa !== undefined) return -1;
        if (pa !== undefined && pb !== undefined && pa !== pb) return sort === "price-asc" ? pa - pb : pb - pa;
      }
      if (sort === "newest") return (b.listedAt ?? "").localeCompare(a.listedAt ?? "");
      return rank(a) - rank(b);
    });
  }, [items, query, selected.category, selected.designer, selected.availability, selected.condition, selected.price, sort, t]);

  const hasGenuine = items.some((i) => i.status !== "editorial_preview" && !i.demo);
  const activeFilters = FILTER_KEYS.filter((k) => selected[k]);

  // Analytics (no personal data).
  useEffect(() => {
    track("collection_view");
  }, []);
  useEffect(() => {
    if (openItem) track("product_view", { ref: openItem.ref, status: openItem.status });
  }, [openItem]);

  // Keep the document title meaningful while an item is open.
  useEffect(() => {
    if (!openItem) return;
    const previous = document.title;
    document.title = `${openItem.brand ? `${openItem.brand} ${openItem.name}` : openItem.name} | SEVN HEVN`;
    return () => {
      document.title = previous;
    };
  }, [openItem]);

  // Debounced search → URL (replace, so each keystroke doesn't add history).
  useEffect(() => {
    if (query === q) return;
    const t = setTimeout(() => {
      navigate((p) => (query.trim() ? p.set("q", query.trim()) : p.delete("q")), "replace");
      if (query.trim()) track("search", { length: query.trim().length });
    }, 350);
    return () => clearTimeout(t);
  }, [query, q, navigate]);

  function setFilter(key: FilterKey | "sort", value: string) {
    navigate((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      p.delete("item");
    });
    if (key !== "sort") track("filter_change", { filter: key, value: value || "all" });
  }

  function clearAll() {
    setQuery("");
    navigate((p) => {
      [...FILTER_KEYS, "q", "sort", "item"].forEach((k) => p.delete(k));
    });
  }

  function open(ref: string) {
    navigate((p) => p.set("item", ref), "push", { sevnItem: true });
  }

  function close() {
    // If we opened the item ourselves, going back restores the previous URL exactly.
    if (window.history.state?.sevnItem) window.history.back();
    else navigate((p) => p.delete("item"), "replace");
  }

  const categoryId = isCategoryId(selected.category) ? selected.category : null;
  const categoryLabel = categoryId ? t.categories[categoryId] : null;
  const selectGroups: { key: Exclude<FilterKey, "category">; label: string }[] = [
    { key: "designer", label: c.filters.designer },
    { key: "availability", label: c.filters.availability },
    { key: "condition", label: c.filters.condition },
    { key: "price", label: c.filters.price },
  ];
  const count = resultCount(results, c, plural);

  return (
    <>
      <div className="coll-head container">
        <div className="coll-head__title">
          <p className="eyebrow">{fmt(c.eyebrow, { label: categoryLabel ?? c.allPieces })}</p>
          <h1 className="display display--sm">{categoryLabel ?? rich(c.title)}</h1>
        </div>
        {!hasGenuine && (
          <p className="coll-head__note">
            {c.note}{" "}
            <button type="button" className="link-btn" onClick={() => openPanel({ type: "sourcing" })}>
              {c.noteLink}
            </button>
          </p>
        )}
      </div>

      {itemRef && !openItem && (
        <div className="container">
          <div className="notice" role="status">
            <p>
              {fmt(c.notFound, { ref: itemRef })}{" "}
              <button type="button" className="link-btn" onClick={() => openPanel({ type: "sourcing", prefill: { details: fmt(c.referencePrefill, { ref: itemRef }) } })}>
                {c.askAbout}
              </button>
            </p>
          </div>
        </div>
      )}

      <div className="coll-bar">
        <div className="container coll-bar__inner">
          <nav aria-label={t.nav.categories} className="coll-tabs">
            <button type="button" aria-pressed={!selected.category} onClick={() => setFilter("category", "")}>
              {c.all}
            </button>
            {categories.map((cat) => (
              <button key={cat.id} type="button" aria-pressed={selected.category === cat.id} onClick={() => setFilter("category", cat.id)}>
                {t.categories[cat.id]}
              </button>
            ))}
          </nav>

          <div className="coll-tools">
            <form role="search" className="coll-search" onSubmit={(e) => e.preventDefault()}>
              <label htmlFor={searchId} className="visually-hidden">
                {c.searchLabel}
              </label>
              <SearchIcon size={18} />
              <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={c.searchPlaceholder} maxLength={80} enterKeyHint="search" dir="auto" />
            </form>

            {selectGroups
              .filter((g) => options[g.key].length >= 2 || selected[g.key])
              .map((g) => (
                <label key={g.key} className="coll-select">
                  <span className="visually-hidden">{g.label}</span>
                  <select value={selected[g.key]} onChange={(e) => setFilter(g.key, e.target.value)}>
                    <option value="">{fmt(c.filterAll, { label: g.label })}</option>
                    {options[g.key].map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

            {(hasPrices || items.some((i) => i.listedAt)) && (
              <label className="coll-select">
                <span className="visually-hidden">{c.sort}</span>
                <select value={sort} onChange={(e) => setFilter("sort", e.target.value)}>
                  <option value="">{c.sortFeatured}</option>
                  {items.some((i) => i.listedAt) && <option value="newest">{c.newest}</option>}
                  {hasPrices && <option value="price-asc">{c.priceAsc}</option>}
                  {hasPrices && <option value="price-desc">{c.priceDesc}</option>}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>

      <section className="container coll-results" aria-labelledby="results-count">
        <div className="coll-results__meta">
          <p id="results-count" ref={resultsRef} aria-live="polite">
            {query.trim() ? fmt(c.resultsFor, { results: count, query: query.trim() }) : count}
          </p>
          {(activeFilters.length > 0 || query) && (
            <button type="button" className="link-btn" onClick={clearAll}>
              {c.clearAll}
            </button>
          )}
        </div>

        {results.length > 0 ? (
          <div className="grid grid--collection">
            {results.map((item, i) => (
              <ItemCard key={item.ref} item={item} onOpen={open} priority={i < 4} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <h2 className="h3">{categoryId && !query.trim() && activeFilters.length === 1 ? c.emptyCategory[categoryId] : c.emptyTitle}</h2>
            <p>{c.emptyText}</p>
            <div className="stack-actions">
              <button
                type="button"
                className="btn btn--dark"
                onClick={() =>
                  openPanel({
                    type: "sourcing",
                    prefill: { category: selected.category || undefined, brand: selected.designer || undefined, details: query.trim() || undefined },
                  })
                }
              >
                {c.requestThis}
              </button>
              <button type="button" className="btn btn--line" onClick={clearAll}>
                {c.clearFilters}
              </button>
            </div>
          </div>
        )}
      </section>

      <Dialog open={!!openItem} onClose={close} title={openItem ? (openItem.brand ? `${openItem.brand} ${openItem.name}` : openItem.name) : c.piece} variant="wide" hideTitle>
        {openItem && <ProductDetail item={openItem} />}
      </Dialog>

    </>
  );
}
