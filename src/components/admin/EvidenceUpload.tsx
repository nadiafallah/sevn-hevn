"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { preparePhoto } from "@/components/concierge/useConcierge";

const problems: Record<string, string> = {
  photo_type: "isn’t a photo or PDF that can be read. Use JPEG, PNG, WebP or PDF.",
  photo_too_large: "is too large (photos up to 20 MB, PDFs up to 8 MB).",
  photo_unreadable: "couldn’t be read. Please try another file.",
  photo_limit: "wasn’t added: this order has the maximum number of files.",
  unauthenticated: "wasn’t added: your session has ended. Please sign in again.",
  invalid_request: "wasn’t added: it doesn’t belong to this order.",
};

/**
 * Adds photos or PDFs to an order's private evidence: the piece, its serial, documents, packing,
 * handover, delivery, a returned piece or its inspection. Photos are scaled down in the browser.
 */
export function EvidenceUpload({ orderId, kind, label, itemId, shipmentId, returnId }: { orderId: string; kind: string; label: string; itemId?: number; shipmentId?: string; returnId?: string }) {
  const router = useRouter();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, 10);
    if (!files.length) return;
    setBusy(true);
    const failed: string[] = [];
    for (const file of files) {
      try {
        const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const form = new FormData();
        form.set("order_id", orderId);
        form.set("kind", kind);
        if (itemId) form.set("order_item_id", String(itemId));
        if (shipmentId) form.set("shipment_id", shipmentId);
        if (returnId) form.set("return_id", returnId);
        form.set("file", pdf ? file : await preparePhoto(file), pdf ? "document.pdf" : "photo.jpg");
        const res = await fetch("/api/admin/order-evidence", { method: "POST", body: form });
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({}))) as { error?: string };
          failed.push(`“${file.name}” ${problems[error ?? ""] ?? "couldn’t be uploaded. Please try again."}`);
        }
      } catch (e) {
        const code = e instanceof Error ? e.message : "";
        failed.push(`“${file.name}” ${problems[code] ?? "couldn’t be uploaded. Please try again."}`);
      }
    }
    setErrors(failed);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="adm-upload">
      <input id={inputId} type="file" accept="image/*,application/pdf" multiple className="visually-hidden" disabled={busy}
        onChange={(e) => { void onFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
      <label htmlFor={inputId} className={`adm-btn${busy ? " is-disabled" : ""}`} aria-disabled={busy}>{busy ? "Uploading…" : label}</label>
      {errors.length > 0 && <ul className="adm-flash adm-flash--error" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
  );
}
