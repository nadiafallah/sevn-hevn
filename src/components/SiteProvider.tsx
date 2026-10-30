"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isPolicyId, type PolicyId } from "@/content/policies";
import { defaultSiteRules, type SiteRules } from "@/lib/compliance-rules";
import { findVariant, maxQuantity } from "@/lib/format";
import type { ShopItem } from "@/lib/paths";
import { track } from "@/lib/analytics";

export interface SourcingPrefill {
  category?: string;
  brand?: string;
  model?: string;
  details?: string;
  relatedRef?: string;
}

export interface ViewingPrefill {
  interest?: string;
  relatedRef?: string;
}

export type Panel =
  | { type: "cart" }
  | { type: "sourcing"; prefill?: SourcingPrefill }
  | { type: "viewing"; prefill?: ViewingPrefill }
  | { type: "contact" }
  | { type: "search" }
  | { type: "menu" }
  | { type: "policy"; id: PolicyId };

/** One line in the bag: a piece, and the version (colour / size) chosen, if it has versions. */
export interface CartLine {
  ref: string;
  sku?: string;
  qty: number;
}

export const lineKey = (l: Pick<CartLine, "ref" | "sku">) => (l.sku ? `${l.ref}|${l.sku}` : l.ref);

interface SiteContextValue {
  panel: Panel | null;
  openPanel: (panel: Panel) => void;
  closePanel: () => void;
  /** The shop's pieces (client-safe fields), for the menu, search and the bag. */
  items: ShopItem[];
  itemByRef: Record<string, ShopItem>;
  /** True only where the server can store website enquiries (the production deployment). */
  websiteEnquiries: boolean;
  /** True once the journal has a published article (shows its links). */
  journal: boolean;
  /** The approved compliance rules the site follows (returns notice, product pages, checkout). */
  rules: SiteRules;
  cart: {
    ready: boolean;
    lines: CartLine[];
    count: number;
    add: (ref: string, sku?: string) => void;
    remove: (key: string) => void;
    setQty: (key: string, qty: number) => void;
    has: (ref: string, sku?: string) => boolean;
    clear: () => void;
  };
}

const SiteContext = createContext<SiteContextValue | null>(null);

const STORAGE_KEY = "sevn-hevn-bag-v2";
/** Bags saved before versions existed hold refs only; they are read once and carried over. */
const LEGACY_KEY = "sevn-hevn-bag-v1";

function readStoredCart(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_KEY) ?? "[]";
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l) => typeof l?.ref === "string" && Number.isInteger(l?.qty) && l.qty > 0)
      .slice(0, 20)
      .map((l) => ({ ref: l.ref.slice(0, 40), ...(typeof l.sku === "string" && l.sku ? { sku: l.sku.slice(0, 48) } : {}), qty: Math.min(l.qty, 10) }));
  } catch {
    return [];
  }
}

export function SiteProvider({ items, websiteEnquiries, journal = false, rules = defaultSiteRules, children }: { items: ShopItem[]; websiteEnquiries: boolean; journal?: boolean; rules?: SiteRules; children: ReactNode }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  const itemByRef = useMemo(() => Object.fromEntries(items.map((c) => [c.ref, c])), [items]);

  useEffect(() => {
    // Restore the bag after hydration; localStorage is unavailable on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(readStoredCart());
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLines(readStoredCart());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
      window.localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* storage may be blocked; the bag still works for this visit */
    }
  }, [lines, ready]);

  // Policy panels can be linked directly, e.g. /#privacy
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (isPolicyId(id)) setPanel({ type: "policy", id });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const openPanel = useCallback((p: Panel) => setPanel(p), []);
  const closePanel = useCallback(() => {
    setPanel((current) => {
      if (current?.type === "policy" && window.location.hash === `#${current.id}`) {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      }
      return null;
    });
  }, []);

  const limitFor = useCallback(
    (ref: string, sku?: string) => {
      const item = itemByRef[ref];
      return item ? maxQuantity(item, findVariant(item, sku)) : 1;
    },
    [itemByRef],
  );

  const add = useCallback(
    (ref: string, sku?: string) => {
      if (!itemByRef[ref]) return;
      const key = lineKey({ ref, sku });
      setLines((prev) => {
        const existing = prev.find((l) => lineKey(l) === key);
        if (existing) return prev.map((l) => (lineKey(l) === key ? { ...l, qty: Math.min(l.qty + 1, limitFor(ref, sku)) } : l));
        return [...prev, { ref, ...(sku ? { sku } : {}), qty: 1 }];
      });
      track("add_to_bag", { ref });
    },
    [itemByRef, limitFor],
  );

  const remove = useCallback((key: string) => setLines((prev) => prev.filter((l) => lineKey(l) !== key)), []);

  const setQty = useCallback(
    (key: string, qty: number) => setLines((prev) => prev.map((l) => (lineKey(l) === key ? { ...l, qty: Math.max(1, Math.min(qty, limitFor(l.ref, l.sku))) } : l))),
    [limitFor],
  );

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<SiteContextValue>(
    () => ({
      panel,
      openPanel,
      closePanel,
      items,
      itemByRef,
      websiteEnquiries,
      journal,
      rules,
      cart: {
        ready,
        lines,
        count: lines.reduce((n, l) => n + l.qty, 0),
        add,
        remove,
        setQty,
        has: (ref, sku) => lines.some((l) => lineKey(l) === lineKey({ ref, sku })),
        clear,
      },
    }),
    [panel, openPanel, closePanel, items, itemByRef, websiteEnquiries, journal, rules, ready, lines, add, remove, setQty, clear],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSite must be used inside <SiteProvider>");
  return ctx;
}
