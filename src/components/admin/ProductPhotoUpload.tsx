"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { preparePhoto } from "@/components/concierge/useConcierge";

const problems: Record<string, string> = {
  photo_type: "isn’t a photo the browser can read. Use JPEG, PNG or WebP (on iPhone, Safari converts photos automatically).",
  photo_too_large: "is too large. Please choose a photo under 20 MB.",
  photo_unreadable: "couldn’t be read. Please try another photo.",
  photo_limit: "wasn’t added: a piece can have up to 12 photos.",
  owner_only: "wasn’t added: only the owner can add photos.",
  unauthenticated: "wasn’t added: your session has ended. Please sign in again.",
  not_found: "wasn’t added: this piece no longer exists.",
};

/** Adds photos to a piece: each one is scaled down in the browser, then sent one at a time. */
export function ProductPhotoUpload({ productRef, altBase, count, limit }: { productRef: string; altBase: string; count: number; limit: number }) {
  const router = useRouter();
  const inputId = useId();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const room = Math.max(0, limit - count);

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const chosen = files.slice(0, room);
    const failed: string[] = files.length > room ? [`${files.length - room} photo(s) ${problems.photo_limit}`] : [];
    setErrors([]);
    setProgress({ done: 0, total: chosen.length });
    for (const [i, file] of chosen.entries()) {
      try {
        const blob = await preparePhoto(file);
        const form = new FormData();
        form.set("ref", productRef);
        form.set("alt", `${altBase}, photo ${count + i + 1}`);
        form.set("file", blob, "photo.jpg");
        const res = await fetch("/api/admin/product-photo", { method: "POST", body: form });
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({}))) as { error?: string };
          failed.push(`“${file.name}” ${problems[error ?? ""] ?? "couldn’t be uploaded. Please try again."}`);
        }
      } catch (e) {
        const code = e instanceof Error ? e.message : "";
        failed.push(`“${file.name}” ${problems[code] ?? "couldn’t be uploaded. Please try again."}`);
      }
      setProgress({ done: i + 1, total: chosen.length });
    }
    setErrors(failed);
    setProgress(null);
    router.refresh();
  }

  const busy = progress !== null;
  return (
    <div className="adm-upload">
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="visually-hidden"
        disabled={busy || room === 0}
        onChange={(e) => {
          void onFiles(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <label htmlFor={inputId} className={`adm-btn adm-btn--dark${busy || room === 0 ? " is-disabled" : ""}`} aria-disabled={busy || room === 0}>
        {count === 0 ? "Add photos" : "Add more photos"}
      </label>
      <p className="adm-muted adm-small" role="status" aria-live="polite">
        {busy
          ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
          : room === 0
            ? "This piece has the maximum of 12 photos."
            : "Choose one or more photos (up to 12 per piece). The first photo is the main one. Location data is removed."}
      </p>
      {errors.length > 0 && (
        <ul className="adm-flash adm-flash--error" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
