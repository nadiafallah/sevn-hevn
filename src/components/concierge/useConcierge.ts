"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isLocale, type Locale } from "@/lib/concierge/i18n";
import { introMessages, menuPrompt } from "@/lib/concierge/intro";
import type { ClientMessage, ClientReply, Prompt } from "@/lib/concierge/types";
import { track } from "@/lib/analytics";

/**
 * Client state for the concierge chat. The conversation itself lives in the database; the browser
 * only keeps the conversation id and its access token so a reload (or the /chat page) can resume it.
 */

const STORAGE_KEY = "sevn-hevn-concierge-v1";

export type ChatError = "start_failed" | "connection" | "rate_limited" | "unavailable" | "server_error" | "photo_type" | "photo_too_large" | "photo_failed" | "photo_limit";

type Payload = { action: "start" | "reply"; input: Record<string, unknown> } | { action: "photo"; file: Blob };

interface Pending {
  clientMsgId: string;
  payload: Payload;
  /** What to show while waiting (the customer's text). */
  preview?: string;
}

interface Stored {
  id: string;
  token: string;
  locale: Locale;
}

function readStored(): Stored | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    return v && typeof v.id === "string" && typeof v.token === "string" && isLocale(v.locale) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(v: Stored | null) {
  try {
    if (v) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the chat still works for this visit */
  }
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

export function useConcierge(source: "widget" | "page", active: boolean) {
  const [locale, setLocale] = useState<Locale>("en");
  const [messages, setMessages] = useState<ClientMessage[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "busy" | "unavailable">("loading");
  const [error, setError] = useState<ChatError | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);
  const conv = useRef<Stored | null>(null);
  const booted = useRef(false);
  const [bootAttempt, setBootAttempt] = useState(0);

  const showIntro = useCallback((l: Locale) => {
    setMessages(introMessages(l).map((body) => ({ role: "assistant", body })));
    setPrompt(menuPrompt(l));
  }, []);

  // Resume a stored conversation, or check availability and show the greeting.
  useEffect(() => {
    if (!active || booted.current) return;
    booted.current = true;
    const stored = readStored();
    // English unless the customer chose Arabic earlier in this conversation.
    const l = stored?.locale ?? "en";
    setLocale(l);
    (async () => {
      try {
        if (stored) {
          const res = await fetch("/api/concierge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "load", conversation: { id: stored.id, token: stored.token } }),
          });
          if (res.ok) {
            const data = (await res.json()) as ClientReply;
            conv.current = stored;
            setLocale(data.locale);
            setMessages(data.messages);
            setPrompt(data.prompt);
            setSubmittedRef(data.submitted?.reference ?? null);
            setStatus("ready");
            return;
          }
          // Expired or unknown conversation: start fresh.
          writeStored(null);
          if (res.status === 503) {
            setStatus("unavailable");
            return;
          }
        }
        const avail = await fetch("/api/concierge", { cache: "no-store" });
        const { available } = (await avail.json()) as { available: boolean };
        if (!available) {
          setStatus("unavailable");
          return;
        }
        showIntro(l);
        setStatus("ready");
      } catch {
        // Nothing has been sent yet: say the chat couldn't connect and offer a retry of this check.
        setMessages([]);
        setPrompt(null);
        setStatus("ready");
        setError("start_failed");
      }
    })();
  }, [active, showIntro, bootAttempt]);

  const retryStart = useCallback(() => {
    booted.current = false;
    setError(null);
    setStatus("loading");
    setBootAttempt((n) => n + 1);
  }, []);

  const apply = useCallback((data: ClientReply, replaceAll: boolean) => {
    setLocale(data.locale);
    setMessages((prev) => (replaceAll ? data.messages : [...prev, ...data.messages]));
    setPrompt(data.prompt);
    if (data.submitted) {
      setSubmittedRef(data.submitted.reference);
      track("concierge_request_submitted", {});
    }
    if (conv.current) {
      conv.current = { ...conv.current, locale: data.locale };
      writeStored(conv.current);
    }
  }, []);

  const run = useCallback(
    async (p: Pending) => {
      setPending(p);
      setStatus("busy");
      setError(null);
      try {
        let res: Response;
        const c = conv.current;
        if (p.payload.action === "photo") {
          const form = new FormData();
          form.set("id", c!.id);
          form.set("token", c!.token);
          form.set("clientMsgId", p.clientMsgId);
          form.set("file", p.payload.file, "photo.jpg");
          res = await fetch("/api/concierge/photo", { method: "POST", body: form });
        } else if (!c) {
          res = await fetch("/api/concierge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "start", locale, source, clientMsgId: p.clientMsgId, ...(p.payload.input.type ? { input: p.payload.input } : {}) }),
          });
        } else {
          res = await fetch("/api/concierge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "reply", conversation: { id: c.id, token: c.token }, clientMsgId: p.clientMsgId, input: p.payload.input }),
          });
        }
        const data = (await res.json().catch(() => ({}))) as ClientReply & { error?: string };
        if (!res.ok) {
          const code = data.error;
          if (code === "conversation_not_found" || code === "expired") {
            // The stored conversation is gone: begin again without losing what is on screen.
            writeStored(null);
            conv.current = null;
          }
          setError(
            code === "rate_limited" ? "rate_limited"
            : code === "unavailable" ? "unavailable"
            : code === "photo_type" ? "photo_type"
            : code === "photo_too_large" ? "photo_too_large"
            : code === "photo_limit" ? "photo_limit"
            : p.payload.action === "photo" ? "photo_failed"
            : "server_error",
          );
          if (code === "unavailable") setStatus("unavailable");
          else setStatus("ready");
          setPending(code === "rate_limited" || code === "server_error" ? p : null);
          return;
        }
        if (data.conversation?.token) {
          conv.current = { id: data.conversation.id, token: data.conversation.token, locale: data.locale };
          writeStored(conv.current);
          track("concierge_started", { source });
        }
        apply(data, !c);
        setPending(null);
        setStatus("ready");
      } catch {
        // Network failure: keep the action so "Try again" resends it with the same id (no duplicates).
        setError("connection");
        setStatus("ready");
      }
    },
    [apply, locale, source],
  );

  const send = useCallback(
    (input: Record<string, unknown>, preview?: string) => run({ clientMsgId: newId(), payload: { action: conv.current ? "reply" : "start", input }, preview }),
    [run],
  );

  const retry = useCallback(() => {
    if (pending) run(pending);
  }, [pending, run]);

  const changeLocale = useCallback(
    (l: Locale) => {
      if (l === locale) return;
      if (!conv.current) {
        setLocale(l);
        showIntro(l);
        return;
      }
      send({ type: "locale", value: l });
    },
    [locale, send, showIntro],
  );

  const startOver = useCallback(() => {
    if (!conv.current) {
      showIntro(locale);
      setError(null);
      return;
    }
    if (submittedRef) {
      // A finished conversation: start a brand-new one (the old one stays with the team).
      writeStored(null);
      conv.current = null;
      setSubmittedRef(null);
      setError(null);
      setPending(null);
      showIntro(locale);
      return;
    }
    send({ type: "restart" });
  }, [locale, send, showIntro, submittedRef]);

  const uploadPhoto = useCallback(
    async (file: Blob) => {
      if (!conv.current) {
        // A photo can be the first thing a customer sends: open the conversation first.
        setStatus("busy");
        try {
          const res = await fetch("/api/concierge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "start", locale, source }),
          });
          const data = (await res.json().catch(() => ({}))) as ClientReply & { error?: string };
          if (!res.ok || !data.conversation?.token) {
            setError(data.error === "rate_limited" ? "rate_limited" : data.error === "unavailable" ? "unavailable" : "photo_failed");
            setStatus(data.error === "unavailable" ? "unavailable" : "ready");
            return;
          }
          conv.current = { id: data.conversation.id, token: data.conversation.token, locale: data.locale };
          writeStored(conv.current);
          apply(data, true);
        } catch {
          setError("connection");
          setStatus("ready");
          return;
        }
      }
      await run({ clientMsgId: newId(), payload: { action: "photo", file } });
    },
    [apply, locale, run, source],
  );

  return { locale, messages, prompt, status, error, pending, submittedRef, send, retry, retryStart, changeLocale, startOver, uploadPhoto, clearError: () => setError(null) };
}

/**
 * Scales a photo down in the browser before upload (max 2000 px, JPEG). Drawing it again also drops
 * metadata such as GPS location. The server re-checks and re-encodes it regardless.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") && file.type !== "") throw new Error("photo_type");
  if (file.size > 20 * 1024 * 1024) throw new Error("photo_too_large");
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (blob && blob.size <= 4 * 1024 * 1024) return blob;
  } catch {
    /* the browser can't decode it (e.g. HEIC outside Safari): fall through */
  }
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 4 * 1024 * 1024) return file;
  throw new Error(file.size > 4 * 1024 * 1024 ? "photo_too_large" : "photo_type");
}
