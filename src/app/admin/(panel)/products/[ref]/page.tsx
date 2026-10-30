import Link from "next/link";
import { categoryById, isCategoryId } from "@/data/taxonomy";
import type { Condition } from "@/data/types";
import { DbError, select } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { ProductFields } from "@/components/admin/ProductFields";
import { ProductPhotoUpload } from "@/components/admin/ProductPhotoUpload";
import { conditionLabels, money, when } from "@/lib/admin/labels";
import { PRODUCT_PHOTO_LIMIT, PRODUCT_SELECT, PRODUCT_SELECT_COMPLIANCE, PRODUCT_SELECT_LEGACY, productImageUrl, productStatusLabel, type PanelProduct } from "@/lib/admin/products";
import { deleteProduct, deleteVariant, removeProductPhoto, saveProduct, saveVariant, setMainProductPhoto, setProductPublished } from "../../../actions";

export const metadata = { title: "Piece" };

const REF = /^[A-Za-z0-9-]{2,40}$/;

export default async function ProductPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const { ref } = await params;
  const sp = await searchParams;
  const query = (sel: string) =>
    select<PanelProduct[]>(api, "products", { select: sel, ref: `eq.${ref}`, status: "neq.editorial_preview", "product_images.order": "position.asc,id.asc", ...(sel !== PRODUCT_SELECT_LEGACY ? { "product_variants.order": "position.asc,id.asc" } : {}) }, token);
  // Until the shop migration has run, versions and the new detail fields don't exist yet.
  // Likewise the origin and Arabic composition fields until the compliance migration has run.
  let shopReady = true;
  let complianceReady = true;
  const fallback = (next: () => Promise<PanelProduct[]>, mark: () => void) => (e: unknown) => {
    if (!(e instanceof DbError) || e.status !== 400) throw e;
    mark();
    return next();
  };
  const rows = REF.test(ref)
    ? await query(PRODUCT_SELECT_COMPLIANCE).catch(
        fallback(
          () =>
            query(PRODUCT_SELECT).catch(
              fallback(
                () => query(PRODUCT_SELECT_LEGACY),
                () => {
                  shopReady = false;
                },
              ),
            ),
          () => {
            complianceReady = false;
          },
        ),
      )
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
    ["Hardware", p.hardware],
    ["Size system", p.size_system],
    ["Case diameter", p.case_diameter_mm ? `${p.case_diameter_mm} mm` : null],
    ["Movement", p.movement],
    ["Fineness / carat", p.purity],
    ["Stones", p.stones],
    ["For", p.audience],
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
          <a className="adm-btn" href={`/product/${encodeURIComponent(p.ref)}`} target="_blank" rel="noopener noreferrer">
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

      <section className="adm-card">
        <h2>Versions (colours, sizes)</h2>
        {!shopReady ? (
          <p className="adm-muted">Versions become available once the shop database update has been run (see docs/SHOP.md).</p>
        ) : (
          <>
            <p className="adm-small adm-muted">
              Add a version for each colour, size or hardware of this model you can actually supply. Each has its own code; leave price or stock empty to use the
              piece’s own. A piece for sale with versions is bought as one of them.
            </p>
            {(p.product_variants ?? []).length > 0 && (
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Code</th><th>Colour</th><th>Size</th><th>Hardware</th><th>Price (AED)</th><th>Stock</th><th>Photo</th>{isOwner && <th />}
                  </tr>
                </thead>
                <tbody>
                  {(p.product_variants ?? []).map((v) =>
                    isOwner ? (
                      <tr key={v.id}>
                        <td colSpan={8}>
                          <form action={saveVariant} className="adm-inline adm-variant">
                            <input type="hidden" name="ref" value={p.ref} />
                            <input type="hidden" name="variant" value={v.id} />
                            <input name="sku" defaultValue={v.sku} maxLength={48} aria-label="Code" className="adm-ltr" />
                            <input name="colour" defaultValue={v.colour ?? ""} maxLength={80} aria-label="Colour" />
                            <input name="size" defaultValue={v.size ?? ""} maxLength={40} aria-label="Size" />
                            <input name="hardware" defaultValue={v.hardware ?? ""} maxLength={80} aria-label="Hardware" />
                            <input name="price_aed" defaultValue={v.price_aed ?? ""} inputMode="numeric" maxLength={16} aria-label="Price (AED)" />
                            <input name="stock" type="number" min={0} max={999} defaultValue={v.stock ?? ""} aria-label="Stock" />
                            <select name="image_id" defaultValue={v.image_id ?? ""} aria-label="Photo">
                              <option value="">—</option>
                              {photos.map((ph, i) => (
                                <option key={ph.id} value={ph.id}>Photo {i + 1}</option>
                              ))}
                            </select>
                            <button type="submit" className="adm-btn">Save</button>
                            <button type="submit" formAction={deleteVariant} className="adm-link adm-link--danger">Remove</button>
                          </form>
                        </td>
                      </tr>
                    ) : (
                      <tr key={v.id}>
                        <td className="adm-ltr">{v.sku}</td><td>{v.colour ?? "—"}</td><td>{v.size ?? "—"}</td><td>{v.hardware ?? "—"}</td>
                        <td>{v.price_aed ? money(v.price_aed, "AED") : "Piece price"}</td><td>{v.stock ?? "Piece stock"}</td>
                        <td>{v.image_id ? `Photo ${photos.findIndex((ph) => ph.id === v.image_id) + 1}` : "—"}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}
            {isOwner && (
              <form action={saveVariant} className="adm-form">
                <input type="hidden" name="ref" value={p.ref} />
                <div className="adm-row">
                  <label>Code (optional)<input name="sku" maxLength={48} placeholder={`${p.ref}-1`} /></label>
                  <label>Colour<input name="colour" maxLength={80} /></label>
                  <label>Size<input name="size" maxLength={40} /></label>
                  <label>Hardware<input name="hardware" maxLength={80} /></label>
                </div>
                <div className="adm-row">
                  <label>Price (AED, optional)<input name="price_aed" inputMode="numeric" maxLength={16} /></label>
                  <label>Stock (optional)<input name="stock" type="number" min={0} max={999} /></label>
                  <label>
                    Photo
                    <select name="image_id" defaultValue="">
                      <option value="">—</option>
                      {photos.map((ph, i) => (
                        <option key={ph.id} value={ph.id}>Photo {i + 1}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="submit" className="adm-btn">Add version</button>
              </form>
            )}
          </>
        )}
      </section>

      {isOwner ? (
        <section className="adm-card">
          <h2>Details</h2>
          <form action={saveProduct} className="adm-form">
            <input type="hidden" name="ref" value={p.ref} />
            <ProductFields p={p} compliance={complianceReady} />
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
