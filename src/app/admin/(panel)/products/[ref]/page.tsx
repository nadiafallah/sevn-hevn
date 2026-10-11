import Link from "next/link";
import { categoryById, isCategoryId } from "@/data/taxonomy";
import type { Condition } from "@/data/types";
import { select } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { ProductFields } from "@/components/admin/ProductFields";
import { ProductPhotoUpload } from "@/components/admin/ProductPhotoUpload";
import { conditionLabels, money, when } from "@/lib/admin/labels";
import { PRODUCT_PHOTO_LIMIT, PRODUCT_SELECT, productImageUrl, productStatusLabel, type PanelProduct } from "@/lib/admin/products";
import { deleteProduct, removeProductPhoto, saveProduct, setMainProductPhoto, setProductPublished } from "../../../actions";

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
