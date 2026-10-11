import Link from "next/link";
import { categoryById, isCategoryId } from "@/data/taxonomy";
import type { Condition } from "@/data/types";
import { select } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { ProductFields } from "@/components/admin/ProductFields";
import { ProductPhotoUpload } from "@/components/admin/ProductPhotoUpload";
import { ProductViewEditor } from "@/components/admin/ProductViewEditor";
import { ViewPreview } from "@/components/admin/ViewPreview";
import type { Item } from "@/data/types";
import { SPIN_MAX_FRAMES, SPIN_MIN_FRAMES, attachView, mediaUrl, type MediaRow, type ViewRow } from "@/lib/views";
import { conditionLabels, money, when } from "@/lib/admin/labels";
import { PRODUCT_PHOTO_LIMIT, PRODUCT_SELECT, productImageUrl, productStatusLabel, type PanelProduct } from "@/lib/admin/products";
import {
  deleteProduct, moveViewMedia, removeProductPhoto, removeViewMedia, removeViewModel, reverseViewFrames, saveProduct, saveView, setMainProductPhoto, setProductPublished,
} from "../../../actions";

export const metadata = { title: "Piece" };

const REF = /^[A-Za-z0-9-]{2,40}$/;

export default async function ProductPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const { ref } = await params;
  const sp = await searchParams;
  const rows = REF.test(ref)
    ? await select<PanelProduct[]>(api, "products", { select: PRODUCT_SELECT, ref: `eq.${ref}`, status: "neq.editorial_preview", "product_images.order": "position.asc,id.asc" }, token)
    : [];
  const p = rows[0];
  if (!p) {
    return (
      <>
        <p className="adm-crumbs">
          <Link href="/admin/products">← Products</Link>
        </p>
        <Flash ok={one(sp.ok)} error={one(sp.error)} />
        <p className="adm-empty">This piece doesn’t exist (it may have been deleted).</p>
      </>
    );
  }
  const title = [p.brand, p.name].filter(Boolean).join(" ");
  const photos = p.product_images.map((i) => ({ ...i, url: productImageUrl(i.storage_path) }));

  // 360° view: read separately, so the page still works before the 360° database update.
  type FullView = ViewRow & { enabled: boolean; model_animations: string[] };
  type FullMedia = MediaRow & { id: number; position: number };
  let view: FullView | null = null;
  let media: FullMedia[] = [];
  let viewReady = true;
  try {
    const [v, m] = await Promise.all([
      select<FullView[]>(api, "product_views", { select: "*", product_ref: `eq.${p.ref}` }, token),
      select<FullMedia[]>(api, "product_view_media", { select: "*", product_ref: `eq.${p.ref}`, order: "kind.asc,position.asc,id.asc" }, token),
    ]);
    view = v[0] ?? null;
    media = m;
  } catch {
    viewReady = false;
  }
  const supabase = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const frames = media.filter((m) => m.kind === "frame");
  const inside = media.filter((m) => m.kind === "interior");
  const kind = view?.kind ?? "spin";
  const spinOk = frames.length >= SPIN_MIN_FRAMES && frames.length <= SPIN_MAX_FRAMES;
  const modelOk = Boolean(view?.model_path);
  const previewItem: Item | null = view
    ? attachView(
        { ref: p.ref, name: p.name, brand: p.brand ?? undefined, status: "enquiry_only", category: "bags", images: photos[0]?.url ? [{ src: photos[0].url, width: photos[0].width, height: photos[0].height, alt: title }] : [] },
        supabase,
        view,
        media,
      )
    : null;

  const details: [string, string | null | undefined][] = [
    ["Category", [isCategoryId(p.category) ? categoryById[p.category].label : p.category, p.subcategory].filter(Boolean).join(" · ")],
    ["Model / reference", p.model_reference],
    ["Condition", [p.condition ? conditionLabels[p.condition as Condition] : null, p.condition_notes].filter(Boolean).join(" — ")],
    ["Year", p.year],
    ["Size", p.size],
    ["Material", p.material],
    ["Colour", p.colour],
    ["Dimensions", p.dimensions],
    ["Comes with", p.included.join(", ")],
    ["Authentication", p.authentication],
    ["Price", p.price_aed ? money(p.price_aed, "AED") : "On enquiry"],
    ["Stock", p.stock?.toString()],
    ["Delivery", p.delivery],
    ["Returns", p.returns],
    ["Description", p.description],
  ];

  return (
    <>
      <p className="adm-crumbs">
        <Link href="/admin/products">← Products</Link>
      </p>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <header className="adm-head">
        <h1 className="adm-h1">
          {title}{" "}
          <span className={`adm-badge adm-badge--${p.published ? "k-approved" : "k-draft"}`}>{p.published ? "Published" : "Draft"}</span>
          {p.featured && <span className="adm-badge">Featured</span>}
        </h1>
        {p.published && (
          <a className="adm-btn" href={`/collection?item=${encodeURIComponent(p.ref)}`} target="_blank" rel="noopener noreferrer">
            View on the website
          </a>
        )}
      </header>
      <p className="adm-muted adm-small">
        <span className="adm-ltr">{p.ref}</span> · {productStatusLabel(p.status)} · updated {when(p.updated_at)}
      </p>

      {isOwner && (
        <section className="adm-card">
          <h2>Website</h2>
          {p.published ? (
            <form action={setProductPublished} className="adm-inline">
              <input type="hidden" name="ref" value={p.ref} />
              <input type="hidden" name="published" value="false" />
              <p className="adm-small">This piece is on the website.</p>
              <button type="submit" className="adm-btn">
                Hide from the website
              </button>
            </form>
          ) : (
            <form action={setProductPublished} className="adm-inline">
              <input type="hidden" name="ref" value={p.ref} />
              <input type="hidden" name="published" value="true" />
              <p className="adm-small">{photos.length ? "Draft: only the team can see it." : "Draft. Add at least one photo to publish it."}</p>
              <button type="submit" className="adm-btn adm-btn--dark" disabled={photos.length === 0}>
                Publish on the website
              </button>
            </form>
          )}
        </section>
      )}

      <section className="adm-card">
        <h2>Photos</h2>
        {photos.length === 0 ? (
          <p className="adm-muted">No photos yet.</p>
        ) : (
          <ul className="adm-photos adm-photos--product">
            {photos.map((ph, i) => (
              <li key={ph.id}>
                {ph.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ph.url} alt={ph.alt} width={ph.width} height={ph.height} loading="lazy" />
                ) : (
                  <span className="adm-muted">Photo unavailable</span>
                )}
                {i === 0 && <span className="adm-badge adm-badge--main">Main photo</span>}
                {isOwner && (
                  <div className="adm-photo-actions">
                    {i > 0 && (
                      <form action={setMainProductPhoto}>
                        <input type="hidden" name="ref" value={p.ref} />
                        <input type="hidden" name="photo" value={ph.id} />
                        <button type="submit" className="adm-link">
                          Make main
                        </button>
                      </form>
                    )}
                    <form action={removeProductPhoto}>
                      <input type="hidden" name="ref" value={p.ref} />
                      <input type="hidden" name="photo" value={ph.id} />
                      <button type="submit" className="adm-link adm-link--danger">
                        Remove
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {isOwner && <ProductPhotoUpload productRef={p.ref} altBase={title} count={photos.length} limit={PRODUCT_PHOTO_LIMIT} />}
      </section>

      <section className="adm-card" id="view">
        <h2>360° view</h2>
        {!viewReady ? (
          <p className="adm-muted">360° views need the one-time database update (supabase/migrations/20261012120000_product_360.sql). Until it is run, pieces show their photos only.</p>
        ) : (
          <>
            <ul className="adm-checklist">
              <li data-ok={view?.enabled || undefined}>{view?.enabled ? "On: shown on the website" : "Off: not shown on the website"}{view?.enabled && !p.published ? " (once the piece is published)" : ""}</li>
              <li data-ok={spinOk || undefined}>
                Photo spin: {frames.length} of {SPIN_MIN_FRAMES}–{SPIN_MAX_FRAMES} frames{frames[0] ? `, ${frames[0].width}×${frames[0].height}` : ""}
              </li>
              <li data-ok={modelOk || undefined}>
                3D model: {modelOk ? `checked .glb, ${((view?.model_bytes ?? 0) / 1048576).toFixed(1)} MB${view?.model_animations.length ? `, animations: ${view.model_animations.join(", ")}` : ", no animations"}` : "none"}
              </li>
              <li data-ok={inside.length > 0 || undefined}>Inside photos: {inside.length || "none (the “View inside” button stays hidden)"}</li>
            </ul>

            {frames.length > 0 && (
              <>
                <h3 className="adm-subhead">Spin frames (in turning order)</h3>
                <ol className="adm-frames">
                  {frames.map((f, i) => (
                    <li key={f.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={supabase ? mediaUrl(supabase, f.storage_path) : ""} alt={`Frame ${i + 1}`} width={f.width} height={f.height} loading="lazy" />
                      <span className="adm-frames__n">{i + 1}</span>
                      {isOwner && (
                        <div className="adm-photo-actions">
                          {i > 0 && <MediaButton action={moveViewMedia} ref_={p.ref} media={f.id} extra={{ delta: "-1" }} label="←" title={`Move frame ${i + 1} earlier`} />}
                          {i < frames.length - 1 && <MediaButton action={moveViewMedia} ref_={p.ref} media={f.id} extra={{ delta: "1" }} label="→" title={`Move frame ${i + 1} later`} />}
                          <MediaButton action={removeViewMedia} ref_={p.ref} media={f.id} label="×" title={`Remove frame ${i + 1}`} danger />
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                {isOwner && (
                  <form action={reverseViewFrames} className="adm-inline">
                    <input type="hidden" name="ref" value={p.ref} />
                    <button type="submit" className="adm-link">Reverse the order (if the piece turns the wrong way)</button>
                  </form>
                )}
              </>
            )}

            {inside.length > 0 && (
              <>
                <h3 className="adm-subhead">Inside photos</h3>
                <ul className="adm-photos adm-photos--product">
                  {inside.map((m, i) => (
                    <li key={m.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={supabase ? mediaUrl(supabase, m.storage_path) : ""} alt={m.alt ?? `Inside ${i + 1}`} width={m.width} height={m.height} loading="lazy" />
                      {isOwner && (
                        <div className="adm-photo-actions">
                          {i > 0 && <MediaButton action={moveViewMedia} ref_={p.ref} media={m.id} extra={{ delta: "-1" }} label="Earlier" title="Show earlier" />}
                          <MediaButton action={removeViewMedia} ref_={p.ref} media={m.id} label="Remove" title="Remove this photo" danger />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {isOwner && modelOk && (
              <form action={removeViewModel} className="adm-inline">
                <input type="hidden" name="ref" value={p.ref} />
                <button type="submit" className="adm-link adm-link--danger">Remove the 3D model</button>
              </form>
            )}

            {isOwner && <ProductViewEditor productRef={p.ref} altBase={title} frames={frames.length} interior={inside.length} />}

            {isOwner && (view || frames.length > 0) && (
              <form action={saveView} className="adm-form adm-view-settings">
                <input type="hidden" name="ref" value={p.ref} />
                <fieldset>
                  <legend>Show on the website as</legend>
                  <label>
                    <input type="radio" name="kind" value="spin" defaultChecked={kind === "spin"} /> Photo spin (turns left and right)
                  </label>
                  <label>
                    <input type="radio" name="kind" value="model" defaultChecked={kind === "model"} disabled={!modelOk} /> 3D model (any angle)
                  </label>
                </fieldset>
                {frames.length > 0 && (
                  <label>
                    First frame shown
                    <input type="number" name="start_frame" min={1} max={frames.length} defaultValue={(view?.start_frame ?? 0) + 1} />
                  </label>
                )}
                {modelOk && (
                  <label>
                    Animation that opens the piece
                    <select name="open_animation" defaultValue={view?.open_animation ?? ""}>
                      <option value="">None (no “Open” button)</option>
                      {view?.model_animations.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="adm-check">
                  <input type="checkbox" name="enabled" defaultChecked={view?.enabled} /> Show the 360° view on the website
                </label>
                <button type="submit" className="adm-btn adm-btn--dark">Save 360° settings</button>
              </form>
            )}

            {previewItem?.view && (
              <>
                <h3 className="adm-subhead">Preview (exactly as customers will see it)</h3>
                <ViewPreview item={previewItem} />
              </>
            )}
          </>
        )}
      </section>

      {isOwner ? (
        <section className="adm-card">
          <h2>Details</h2>
          <form action={saveProduct} className="adm-form">
            <input type="hidden" name="ref" value={p.ref} />
            <ProductFields p={p} />
            <button type="submit" className="adm-btn adm-btn--dark">
              Save changes
            </button>
          </form>
        </section>
      ) : (
        <section className="adm-card">
          <h2>Details</h2>
          <dl className="adm-dl">
            {details
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="adm-dl__row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      {isOwner && (
        <details className="adm-card">
          <summary>Delete this piece permanently</summary>
          <form action={deleteProduct} className="adm-form">
            <input type="hidden" name="ref" value={p.ref} />
            <p className="adm-small">
              Deletes the piece and its photos. This cannot be undone. To take a piece off the website but keep it, use “Hide from the website” instead.
            </p>
            <label>
              Type DELETE to confirm
              <input name="confirm" autoComplete="off" required />
            </label>
            <button type="submit" className="adm-btn adm-btn--danger">
              Delete permanently
            </button>
          </form>
        </details>
      )}
    </>
  );
}

/** A one-button form for a 360° frame or photo (move or remove). */
function MediaButton({ action, ref_, media, extra = {}, label, title, danger }: { action: (f: FormData) => Promise<void>; ref_: string; media: number; extra?: Record<string, string>; label: string; title: string; danger?: boolean }) {
  return (
    <form action={action}>
      <input type="hidden" name="ref" value={ref_} />
      <input type="hidden" name="media" value={media} />
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className={`adm-link${danger ? " adm-link--danger" : ""}`} aria-label={title} title={title}>
        {label}
      </button>
    </form>
  );
}
