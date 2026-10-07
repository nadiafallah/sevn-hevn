import Link from "next/link";
import { categories, categoryById, isCategoryId } from "@/data/taxonomy";
import { select } from "@/lib/concierge/db";
import { requireStaff } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { money, when } from "@/lib/admin/labels";
import { productImageUrl, productStatusLabel, searchTerm, type PanelProduct } from "@/lib/admin/products";

export const metadata = { title: "Products" };

type Row = Pick<PanelProduct, "ref" | "published" | "status" | "name" | "category" | "brand" | "price_aed" | "stock" | "featured" | "updated_at" | "product_images">;

export default async function Products({ searchParams }: { searchParams: SP }) {
  const { api, token, isOwner } = await requireStaff();
  const sp = await searchParams;
  const q = searchTerm(one(sp.q) ?? "");
  const category = one(sp.category) ?? "";
  const show = one(sp.show) ?? "";

  const query: Record<string, string> = {
    select: "ref,published,status,name,category,brand,price_aed,stock,featured,updated_at,product_images(id,storage_path,width,height,alt,position)",
    status: "neq.editorial_preview",
    order: "updated_at.desc",
    "product_images.order": "position.asc",
    "product_images.limit": "1",
    limit: "500",
  };
  if (isCategoryId(category)) query.category = `eq.${category}`;
  if (show === "published") query.published = "is.true";
  if (show === "drafts") query.published = "is.false";
  if (q) query.or = `(name.ilike.*${q}*,brand.ilike.*${q}*,ref.ilike.*${q}*,model_reference.ilike.*${q}*)`;
  const rows = await select<Row[]>(api, "products", query, token);

  return (
    <>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <header className="adm-head">
        <h1 className="adm-h1">Products</h1>
        {isOwner && (
          <Link href="/admin/products/new" className="adm-btn adm-btn--dark">
            Add a piece
          </Link>
        )}
      </header>
      <p className="adm-muted">
        Pieces you add here appear on the website once they are <strong>published</strong> and have at least one photo. Drafts are visible to the team only.
        {!isOwner && " Only the owner can add or change pieces."}
      </p>
      <form className="adm-filters" role="search">
        <label>
          Search
          <input name="q" defaultValue={q} placeholder="Name, brand or reference" maxLength={60} />
        </label>
        <label>
          Category
          <select name="category" defaultValue={category}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Show
          <select name="show" defaultValue={show}>
            <option value="">Published and drafts</option>
            <option value="published">Published only</option>
            <option value="drafts">Drafts only</option>
          </select>
        </label>
        <button type="submit" className="adm-btn">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="adm-empty">{q || category || show ? "No pieces match." : isOwner ? "No pieces yet. Use “Add a piece” to add your first one." : "No pieces yet."}</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Photo</th>
                <th scope="col">Piece</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Price</th>
                <th scope="col">Stock</th>
                <th scope="col">Website</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const img = p.product_images[0];
                const src = img ? productImageUrl(img.storage_path) : null;
                return (
                  <tr key={p.ref}>
                    <td>
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="adm-thumb" src={src} alt="" width={48} height={60} loading="lazy" />
                      ) : (
                        <span className="adm-thumb adm-thumb--empty" aria-label="No photo yet" />
                      )}
                    </td>
                    <td>
                      <Link href={`/admin/products/${p.ref}`}>{[p.brand, p.name].filter(Boolean).join(" ")}</Link>
                      <div className="adm-muted adm-small adm-ltr">{p.ref}</div>
                    </td>
                    <td>{isCategoryId(p.category) ? categoryById[p.category].label : p.category}</td>
                    <td>{productStatusLabel(p.status)}</td>
                    <td>{p.price_aed ? money(p.price_aed, "AED") : "On enquiry"}</td>
                    <td>{p.stock ?? "—"}</td>
                    <td>
                      <span className={`adm-badge adm-badge--${p.published ? "k-approved" : "k-draft"}`}>{p.published ? "Published" : "Draft"}</span>
                      {p.featured && <span className="adm-badge">Featured</span>}
                    </td>
                    <td>{when(p.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
