"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ItemImage, ItemStatus } from "@/data/types";
import type { PolicyId } from "@/content/policies";
import { policyById } from "@/content/policies";
import { maxQuantity } from "@/lib/format";
import { track } from "@/lib/analytics";

export interface CartCatalogItem {
  ref: string;
  name: string;
  brand?: string;
  status: ItemStatus;
  priceAED?: number;
  stock?: number;
  maxPerOrder?: number;
  image?: ItemImage;
  demo?: boolean;
}

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

export interface CartLine {
  ref: string;
  qty: number;
}

interface SiteContextValue {
  panel: Panel | null;
  openPanel: (panel: Panel) => void;
  closePanel: () => void;
  catalog: Record<string, CartCatalogItem>;
  cart: {
    ready: boolean;
    lines: CartLine[];
    count: number;
    add: (ref: string) => void;
    remove: (ref: string) => void;
    setQty: (ref: string, qty: number) => void;
    has: (ref: string) => boolean;
  };
}

const SiteContext = createContext<SiteContextValue | null>(null);

const STORAGE_KEY = "sevn-hevn-bag-v1";

function readStoredCart(): CartLine[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l) => typeof l?.ref === "string" && Number.isInteger(l?.qty) && l.qty > 0)
      .slice(0, 20)
      .map((l) => ({ ref: l.ref.slice(0, 40), qty: Math.min(l.qty, 10) }));
  } catch {
    return [];
  }
}

export function SiteProvider({ catalog, children }: { catalog: CartCatalogItem[]; children: ReactNode }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  const catalogMap = useMemo(() => Object.fromEntries(catalog.map((c) => [c.ref, c])), [catalog]);

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
    } catch {
      /* storage may be blocked; the bag still works for this visit */
    }
  }, [lines, ready]);

  // Policy panels can be linked directly, e.g. /#privacy
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (id in policyById) setPanel({ type: "policy", id: id as PolicyId });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const openPanel = useCallback((p: Panel) => setPanel(p), []);
  const closePanel = useCallback(() => {
    setPanel((current) => {
      if (current?.type === "policy" && window.location.hash === `#${current.id}`) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      return null;
    });
  }, []);

  const add = useCallback(
    (ref: string) => {
      const item = catalogMap[ref];
      if (!item) return;
      setLines((prev) => {
        const existing = prev.find((l) => l.ref === ref);
        if (existing) {
          const qty = Math.min(existing.qty + 1, maxQuantity(item));
          return prev.map((l) => (l.ref === ref ? { ...l, qty } : l));
        }
        return [...prev, { ref, qty: 1 }];
      });
      track("add_to_bag", { ref });
    },
    [catalogMap],
  );

  const remove = useCallback((ref: string) => setLines((prev) => prev.filter((l) => l.ref !== ref)), []);

  const setQty = useCallback(
    (ref: string, qty: number) => {
      const item = catalogMap[ref];
      const max = item ? maxQuantity(item) : 1;
      setLines((prev) => prev.map((l) => (l.ref === ref ? { ...l, qty: Math.max(1, Math.min(qty, max)) } : l)));
    },
    [catalogMap],
  );

  const value = useMemo<SiteContextValue>(
    () => ({
      panel,
      openPanel,
      closePanel,
      catalog: catalogMap,
      cart: {
        ready,
        lines,
        count: lines.reduce((n, l) => n + l.qty, 0),
        add,
        remove,
        setQty,
        has: (ref) => lines.some((l) => l.ref === ref),
      },
    }),
    [panel, openPanel, closePanel, catalogMap, ready, lines, add, remove, setQty],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSite must be used inside <SiteProvider>");
  return ctx;
}
