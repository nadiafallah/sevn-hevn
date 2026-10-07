import { categories } from "@/data/taxonomy";
import { conditionLabels } from "@/data/types";
import { productStatusOptions, type PanelProduct } from "@/lib/admin/products";

const subcategories = Array.from(new Set(categories.flatMap((c) => c.sub)));

/** The details of a piece. Everything except name and category is optional. */
export function ProductFields({ p }: { p?: PanelProduct }) {
  return (
    <>
      <fieldset className="adm-fieldset">
        <legend>The piece</legend>
        <div className="adm-row">
          <label>
            <span>
              Name <span aria-hidden="true">*</span>
            </span>
            <input name="name" required maxLength={160} defaultValue={p?.name ?? ""} placeholder="e.g. Kelly 28" />
          </label>
          <label>
            Brand
            <input name="brand" maxLength={80} defaultValue={p?.brand ?? ""} placeholder="e.g. Hermès" />
          </label>
        </div>
        <div className="adm-row">
          <label>
            <span>
              Category <span aria-hidden="true">*</span>
            </span>
            <select name="category" required defaultValue={p?.category ?? ""}>
              <option value="" disabled>
                Choose…
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type (optional)
            <input name="subcategory" maxLength={80} list="adm-subcategories" defaultValue={p?.subcategory ?? ""} placeholder="e.g. Handbags" />
            <datalist id="adm-subcategories">
              {subcategories.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            Model or reference number
            <input name="model_reference" maxLength={80} defaultValue={p?.model_reference ?? ""} placeholder="e.g. 126500LN" />
          </label>
        </div>
        <label>
          Description
          <textarea name="description" rows={4} maxLength={2000} defaultValue={p?.description ?? ""} />
        </label>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Condition and details</legend>
        <div className="adm-row">
          <label>
            Condition
            <select name="condition" defaultValue={p?.condition ?? ""}>
              <option value="">Not stated</option>
              {Object.entries(conditionLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <input name="year" maxLength={20} defaultValue={p?.year ?? ""} placeholder="e.g. 2021" />
          </label>
          <label>
            Size
            <input name="size" maxLength={80} defaultValue={p?.size ?? ""} placeholder="e.g. 28 cm, EU 38, 40 mm" />
          </label>
        </div>
        <label>
          Condition notes
          <input name="condition_notes" maxLength={500} defaultValue={p?.condition_notes ?? ""} placeholder="e.g. Light wear on the corners" />
        </label>
        <div className="adm-row">
          <label>
            Material
            <input name="material" maxLength={120} defaultValue={p?.material ?? ""} placeholder="e.g. Togo leather" />
          </label>
          <label>
            Colour
            <input name="colour" maxLength={80} defaultValue={p?.colour ?? ""} placeholder="e.g. Black" />
          </label>
          <label>
            Dimensions
            <input name="dimensions" maxLength={120} defaultValue={p?.dimensions ?? ""} />
          </label>
        </div>
        <label>
          Comes with (separate with commas)
          <input name="included" maxLength={800} defaultValue={p?.included?.join(", ") ?? ""} placeholder="e.g. Box, Dust bag, Receipt" />
        </label>
        <label>
          Authentication (documented facts only)
          <textarea name="authentication" rows={2} maxLength={1000} defaultValue={p?.authentication ?? ""} placeholder="e.g. Entrupy certificate no. …" />
        </label>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Price and availability</legend>
        <div className="adm-row">
          <label>
            Price (AED, whole number)
            <input
              name="price_aed"
              inputMode="numeric"
              pattern="(AED ?)?[0-9][0-9, ]*"
              title="A whole number of dirhams, e.g. 62000 or 62,000"
              maxLength={16}
              defaultValue={p?.price_aed ?? ""}
              placeholder="Leave empty: “Enquire for details”"
            />
          </label>
          <label>
            Stock
            <input name="stock" type="number" min={0} max={999} step={1} defaultValue={p?.stock ?? ""} placeholder="e.g. 1" />
          </label>
          <label>
            Status
            <select name="status" defaultValue={p?.status ?? "enquiry_only"}>
              {productStatusOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul className="adm-hints adm-small adm-muted">
          {productStatusOptions.map((o) => (
            <li key={o.id}>
              <strong>{o.label}:</strong> {o.hint}
            </li>
          ))}
        </ul>
        <label>
          Delivery details
          <textarea name="delivery" rows={2} maxLength={1000} defaultValue={p?.delivery ?? ""} placeholder="e.g. Dubai: same day. Other emirates: 1–2 days. International: on request." />
        </label>
        <label>
          Returns
          <textarea name="returns" rows={2} maxLength={1000} defaultValue={p?.returns ?? ""} />
        </label>
        <input type="hidden" name="featured_shown" value="1" />
        <label className="adm-check">
          <input type="checkbox" name="featured" defaultChecked={p?.featured ?? false} /> Feature on the home page (shown there once at least three pieces are featured)
        </label>
      </fieldset>
    </>
  );
}
