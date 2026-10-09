import { LOCALE_COOKIE, localePath, splitLocale, type Locale } from "./config";

/**
 * Changing language loads the page again in the other language (each language has its own root
 * layout). What the visitor is doing comes along: the same page and item (from the address), the
 * bag and the chat conversation (browser storage), plus — handed over here, for one minute — an open
 * panel, the chat window, form fields typed so far and the scroll position.
 */

const KEY = "sevn-hevn-carry";
const MAX_AGE_MS = 60_000;

export interface Carry {
  at: number;
  panel?: unknown;
  chatOpen?: boolean;
  scrollY?: number;
  forms: Record<string, unknown>;
}

/** Fired just before leaving, so open forms and the chat can add their state to `detail`. */
export const CARRY_EVENT = "sevn:carry";

let loaded: Carry | null | undefined;

function load(): Carry | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    const v = raw ? (JSON.parse(raw) as Carry) : null;
    if (v && typeof v.at === "number" && Date.now() - v.at < MAX_AGE_MS && v.forms && typeof v.forms === "object") loaded = v;
  } catch {
    /* storage blocked: nothing to restore */
  }
  return loaded;
}

/** Takes (once) what a part of the page handed over before the language change. */
export function takeCarried<K extends "panel" | "chatOpen" | "scrollY">(key: K): Carry[K] | undefined {
  const c = load();
  if (!c) return undefined;
  const v = c[key];
  delete c[key];
  return v;
}

export function takeCarriedForm<T>(formKey: string): T | undefined {
  const c = load();
  if (!c) return undefined;
  const v = c.forms[formKey] as T | undefined;
  delete c.forms[formKey];
  return v;
}

/** The same page in another language, keeping the query (?item=…, filters) and hash. */
export function addressIn(locale: Locale) {
  const { path } = splitLocale(window.location.pathname);
  return `${localePath(locale, path)}${window.location.search}${window.location.hash}`;
}

/** Remembers the choice, hands over the page state and opens the page in `locale`. */
export function switchLocale(locale: Locale, panel: unknown) {
  const carry: Carry = { at: Date.now(), panel: panel ?? undefined, scrollY: Math.round(window.scrollY), forms: {} };
  window.dispatchEvent(new CustomEvent<Carry>(CARRY_EVENT, { detail: carry }));
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(carry));
  } catch {
    /* storage blocked: the page still changes language */
  }
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax${secure}`;
  window.location.assign(addressIn(locale));
}
