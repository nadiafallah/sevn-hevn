"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Item } from "@/data/types";
import { conditionLabels, statusLabels } from "@/data/types";
import { categories, categoryById, isCategoryId } from "@/data/taxonomy";
import { track } from "@/lib/analytics";
import { ItemCard } from "./ItemCard";
import { Dialog } from "./Dialog";
import { ProductDetail } from "./ProductDetail";
import { useSite } from "./SiteProvider";
import { SearchIcon } from "./icons";

const PRICE_BANDS = [
  { id: "under-20k", label: "Under AED 20,000", test: (p: number) => p < 20_000 },
  { id: "20k-50k", label: "AED 20,000 – 50,000", test: (p: number) => p >= 20_000 && p < 50_000 },
  { id: "50k-100k", label: "AED 50,000 – 100,000", test: (p: number) => p >= 50_000 && p < 100_000 },
  { id: "100k-plus", label: "AED 100,000 and above", test: (p: number) => p >= 100_000 },
];

const FILTER_KEYS = ["category", "designer", "availability", "condition", "price"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

function normalise(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function haystack(item: Item) {
  return normalise(
    [item.name, item.brand, item.modelReference, item.ref, item.colour, item.material, item.subcategory, categoryById[item.category]?.label, item.description].filter(Boolean).join(" "),
  );
}

export function CollectionView({ items }: { items: Item[] }) {
  const params = useSearchParams();
  const { openPanel } = useSite();
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
      category: categories.filter((c) => items.some((i) => i.category === c.id)).map((c) => ({ id: c.id, label: c.label })),
      designer: uniq(items.map((i) => i.brand))
        .sort()
        .map((b) => ({ id: b, label: b })),
      availability: uniq(items.map((i) => i.status)).map((s) => ({ id: s, label: statusLabels[s] })),
      condition: uniq(items.map((i) => i.condition)).map((c) => ({ id: c, label: conditionLabels[c] })),
      price: priced.length >= 2 ? PRICE_BANDS.filter((b) => priced.some((i) => b.test(i.priceAED!))).map(({ id, label }) => ({ id, label })) : [],
    };
  }, [items]);

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
        const h = haystack(i);
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
  }, [items, query, selected.category, selected.designer, selected.availability, selected.condition, selected.price, sort]);

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

  const categoryLabel = isCategoryId(selected.category) ? categoryById[selected.category].label : null;
  const selectGroups: { key: FilterKey; label: string }[] = [
    { key: "designer", label: "Designer" },
    { key: "availability", label: "Availability" },
    { key: "condition", label: "Condition" },
    { key: "price", label: "Price" },
  ];

  return (
    <>
      <div className="coll-head container">
        <p className="eyebrow">SEVN HEVN · {categoryLabel ?? "All pieces"}</p>
        <h1 className="display display--sm">{categoryLabel ?? "The Collection"}</h1>
        {!hasGenuine && (
          <p className="coll-head__note">
            Listings of available pieces will appear here, with real photographs, condition and prices. Until then, the images below are AI-generated editorial previews — not items
            for sale.{" "}
            <button type="button" className="link-btn" onClick={() => openPanel({ type: "sourcing" })}>
              Looking for something specific? Request a piece.
            </button>
          </p>
        )}
      </div>

      {itemRef && !openItem && (
        <div className="container">
          <div className="notice" role="status">
            <p>
              We couldn’t find the piece “{itemRef}”. It may have been sold or removed.{" "}
              <button type="button" className="link-btn" onClick={() => openPanel({ type: "sourcing", prefill: { details: `Reference ${itemRef}` } })}>
                Ask us about it
              </button>
            </p>
          </div>
        </div>
      )}

      <div className="coll-bar">
        <div className="container coll-bar__inner">
          <nav aria-label="Categories" className="coll-tabs">
            <button type="button" aria-pressed={!selected.category} onClick={() => setFilter("category", "")}>
              All
            </button>
            {options.category.map((c) => (
              <button key={c.id} type="button" aria-pressed={selected.category === c.id} onClick={() => setFilter("category", c.id)}>
                {c.label}
              </button>
            ))}
          </nav>

          <div className="coll-tools">
            <form role="search" className="coll-search" onSubmit={(e) => e.preventDefault()}>
              <label htmlFor={searchId} className="visually-hidden">
                Search the collection
              </label>
              <SearchIcon size={18} />
              <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" maxLength={80} enterKeyHint="search" />
            </form>

            {selectGroups
              .filter((g) => options[g.key].length >= 2 || selected[g.key])
              .map((g) => (
                <label key={g.key} className="coll-select">
                  <span className="visually-hidden">{g.label}</span>
                  <select value={selected[g.key]} onChange={(e) => setFilter(g.key, e.target.value)}>
                    <option value="">{g.label}: all</option>
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
                <span className="visually-hidden">Sort</span>
                <select value={sort} onChange={(e) => setFilter("sort", e.target.value)}>
                  <option value="">Sort: featured</option>
                  {items.some((i) => i.listedAt) && <option value="newest">Newest</option>}
                  {hasPrices && <option value="price-asc">Price: low to high</option>}
                  {hasPrices && <option value="price-desc">Price: high to low</option>}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>

      <section className="container coll-results" aria-labelledby="results-count">
        <div className="coll-results__meta">
          <p id="results-count" ref={resultsRef} aria-live="polite">
            {results.length} {results.length === 1 ? "piece" : "pieces"}
            {query.trim() && <> for “{query.trim()}”</>}
          </p>
          {(activeFilters.length > 0 || query) && (
            <button type="button" className="link-btn" onClick={clearAll}>
              Clear all
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
            <h2 className="h3">Nothing here matches — yet.</h2>
            <p>
              Tell us what you’re looking for and our team will see what’s possible. We’ll prepare a WhatsApp message with your request for you to send.
            </p>
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
                Request this piece
              </button>
              <button type="button" className="btn btn--line" onClick={clearAll}>
                Clear filters
              </button>
            </div>
          </div>
        )}
      </section>

      <Dialog open={!!openItem} onClose={close} title={openItem ? (openItem.brand ? `${openItem.brand} ${openItem.name}` : openItem.name) : "Piece"} variant="wide" hideTitle>
        {openItem && <ProductDetail item={openItem} />}
      </Dialog>

    </>
  );
}
