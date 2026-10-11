"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { preparePhoto } from "@/components/concierge/useConcierge";
import { MAX_MODEL_BYTES, naturalCompare } from "@/lib/media/glb";

const problems: Record<string, string> = {
  photo_type: "isn’t a photo the browser can read. Use JPEG, PNG or WebP.",
  photo_too_large: "is too large. Please choose a photo under 20 MB.",
  photo_unreadable: "couldn’t be read. Please try another photo.",
  media_limit: "wasn’t added: a spin can have up to 72 frames, and a piece up to 12 inside photos.",
  frame_mismatch: "wasn’t added: it has a different shape from the first frame (every frame must be the same size and orientation).",
  owner_only: "wasn’t added: only the owner can change a piece.",
  unauthenticated: "wasn’t added: your session has ended. Please sign in again.",
  not_found: "wasn’t added: this piece no longer exists.",
  model_type: "isn’t a .glb file (glTF 2.0 binary).",
  model_version: "is not glTF 2.0.",
  model_corrupt: "is damaged or incomplete. Please export it again.",
  model_external: "points to separate texture or data files. Export it as one self-contained .glb.",
  model_compressed: "uses Draco/Meshopt/Basis compression, which the website can’t decode. Export it without compression.",
  model_empty: "contains no 3D mesh.",
  model_too_large: "is larger than 25 MB.",
  model_missing: "didn’t reach Storage. Please try again.",
  storage_error: "couldn’t be stored. Please try again.",
};
const say = (name: string, code: string | undefined) => `“${name}” ${problems[code ?? ""] ?? "couldn’t be added. Please try again."}`;

/**
 * Adds 360° material to a piece: spin frames (sorted by file name, as a camera numbers them),
 * interior photographs and a 3D model. Photos are scaled down in the browser and sent one at a
 * time; a model goes straight to Storage through a one-time link and is then checked by the server.
 */
export function ProductViewEditor({ productRef, altBase, frames, interior }: { productRef: string; altBase: string; frames: number; interior: number }) {
  const router = useRouter();
  const ids = { frames: useId(), inside: useId(), model: useId() };
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const busy = status !== null;

  async function uploadPhotos(list: FileList | null, kind: "frame" | "interior") {
    const files = Array.from(list ?? []).sort((a, b) => naturalCompare(a.name, b.name));
    if (!files.length) return;
    const failed: string[] = [];
    setErrors([]);
    for (const [i, file] of files.entries()) {
      setStatus(`${kind === "frame" ? "Uploading frame" : "Uploading inside photo"} ${i + 1} of ${files.length}…`);
      try {
        const blob = await preparePhoto(file);
        const form = new FormData();
        form.set("ref", productRef);
        form.set("kind", kind);
        form.set("alt", kind === "interior" ? `${altBase} — inside, photo ${interior + i + 1}` : "");
        form.set("file", blob, "photo.jpg");
        const res = await fetch("/api/admin/product-media", { method: "POST", body: form });
        if (!res.ok) {
          const { error } = (await res.json().catch(() => ({}))) as { error?: string };
          failed.push(say(file.name, error));
          // A wrong-shaped frame usually means the whole set is mixed up: stop rather than add more.
          if (error === "frame_mismatch" || error === "media_limit") break;
        }
      } catch (e) {
        failed.push(say(file.name, e instanceof Error ? e.message : undefined));
      }
    }
    setErrors(failed);
    setStatus(null);
    router.refresh();
  }

  async function uploadModel(file: File | undefined) {
    if (!file) return;
    setErrors([]);
    if (!/\.glb$/i.test(file.name)) return setErrors([say(file.name, "model_type")]);
    if (file.size > MAX_MODEL_BYTES) return setErrors([say(file.name, "model_too_large")]);
    try {
      setStatus("Preparing the upload…");
      const post = (body: object) => fetch("/api/admin/product-media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const sign = await post({ action: "sign-model", ref: productRef });
      const signed = (await sign.json().catch(() => ({}))) as { path?: string; uploadUrl?: string; apikey?: string; error?: string };
      if (!sign.ok || !signed.uploadUrl || !signed.path) throw new Error(signed.error ?? "storage_error");
      setStatus(`Uploading ${(file.size / 1048576).toFixed(1)} MB…`);
      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "model/gltf-binary", "x-upsert": "false", ...(signed.apikey ? { apikey: signed.apikey } : {}) },
        body: file,
      });
      if (!put.ok) throw new Error("storage_error");
      setStatus("Checking the model…");
      const done = await post({ action: "finish-model", ref: productRef, path: signed.path });
      const result = (await done.json().catch(() => ({}))) as { error?: string };
      if (!done.ok) throw new Error(result.error ?? "storage_error");
    } catch (e) {
      setErrors([say(file.name, e instanceof Error ? e.message : undefined)]);
    }
    setStatus(null);
    router.refresh();
  }

  return (
    <div className="adm-view-upload">
      <div className="adm-actions">
        <input id={ids.frames} type="file" accept="image/*" multiple className="visually-hidden" disabled={busy} onChange={(e) => (void uploadPhotos(e.currentTarget.files, "frame"), (e.currentTarget.value = ""))} />
        <label htmlFor={ids.frames} className={`adm-btn adm-btn--dark${busy ? " is-disabled" : ""}`} aria-disabled={busy}>
          {frames ? "Add more spin frames" : "Add spin frames"}
        </label>
        <input id={ids.inside} type="file" accept="image/*" multiple className="visually-hidden" disabled={busy} onChange={(e) => (void uploadPhotos(e.currentTarget.files, "interior"), (e.currentTarget.value = ""))} />
        <label htmlFor={ids.inside} className={`adm-btn${busy ? " is-disabled" : ""}`} aria-disabled={busy}>
          Add inside photos
        </label>
        <input id={ids.model} type="file" accept=".glb,model/gltf-binary" className="visually-hidden" disabled={busy} onChange={(e) => (void uploadModel(e.currentTarget.files?.[0]), (e.currentTarget.value = ""))} />
        <label htmlFor={ids.model} className={`adm-btn${busy ? " is-disabled" : ""}`} aria-disabled={busy}>
          Upload 3D model (.glb)
        </label>
      </div>
      <p className="adm-muted adm-small" role="status" aria-live="polite">
        {status ??
          "Spin: 12–72 photos taken in one turn around the piece (24 or 36 recommended), all the same size; they are sorted by file name. Inside: real photos of the interior. Model: one .glb file up to 25 MB."}
      </p>
      {errors.length > 0 && (
        <ul className="adm-errors" role="alert">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
