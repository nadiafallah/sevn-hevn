import { coreBrands, findBrand, jewelleryOnlyBrands } from "@/data/brands";
import { categories, subcategoryId, isCategoryId } from "@/data/taxonomy";
import { conditionLabels } from "@/lib/admin/labels";
import { productStatusOptions, type PanelProduct } from "@/lib/admin/products";

/**
 * The details of a piece. Everything except name, category and house is optional; fill in only what
 * is documented. Houses are limited to the shop's list (also enforced by the database).
 */
export function ProductFields({ p, compliance = false }: { p?: PanelProduct; compliance?: boolean }) {
  const brand = findBrand(p?.brand)?.name ?? p?.brand ?? "";
  const type = p && isCategoryId(p.category) ? (subcategoryId(p.category, p.subcategory) ?? "") : "";
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
            <span>
              House <span aria-hidden="true">*</span>
            </span>
            <select name="brand" required defaultValue={brand}>
              <option value="" disabled>
                Choose…
              </option>
              <optgroup label="Bags, shoes, watches and jewellery">
                {coreBrands.map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Jewellery only">
                {jewelleryOnlyBrands.map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
              {brand && !findBrand(brand) && (
                <option value={brand} disabled>
                  {brand} (not a shop house — choose another to save)
                </option>
              )}
            </select>
          </label>
        </div>
        <div className="adm-row">
          <label>
            <span>
              Category <span aria-hidden="true">*</span>
            </span>
            <select name="category" required defaultValue={p && isCategoryId(p.category) ? p.category : ""}>
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
            <select name="subcategory" defaultValue={type}>
              <option value="">Not set</option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.label}>
                  {c.sub.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Model or reference number
            <input name="model_reference" maxLength={80} defaultValue={p?.model_reference ?? ""} placeholder="e.g. a watch reference" />
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
            For
            <select name="audience" defaultValue={p?.audience ?? ""}>
              <option value="">Not set</option>
              <option value="women">Women</option>
              <option value="men">Men</option>
              <option value="unisex">Unisex</option>
            </select>
          </label>
        </div>
        <label>
          Condition notes (needed to publish a pre-owned piece: excellent, very good, good or fair)
          <input name="condition_notes" maxLength={500} defaultValue={p?.condition_notes ?? ""} placeholder="e.g. Light wear on the corners" />
        </label>
        <div className="adm-row">
          <label>
            Material
            <input name="material" maxLength={120} defaultValue={p?.material ?? ""} placeholder="e.g. Togo leather, 18k yellow gold" />
          </label>
          <label>
            Colour
            <input name="colour" maxLength={80} defaultValue={p?.colour ?? ""} placeholder="e.g. Noir" />
          </label>
          <label>
            Hardware (bags, shoes)
            <input name="hardware" maxLength={80} defaultValue={p?.hardware ?? ""} placeholder="e.g. Gold-tone" />
          </label>
        </div>
        <div className="adm-row">
          <label>
            Size
            <input name="size" maxLength={80} defaultValue={p?.size ?? ""} placeholder="e.g. 25 (bag), 40.5 (shoe), 52 (ring)" />
          </label>
          <label>
            Size system (shoes)
            <select name="size_system" defaultValue={p?.size_system ?? ""}>
              <option value="">Not set</option>
              {["EU", "IT", "FR", "UK", "US"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Dimensions (bags)
            <input name="dimensions" maxLength={120} defaultValue={p?.dimensions ?? ""} placeholder="e.g. 25 × 19 × 9 cm" />
          </label>
        </div>
        <div className="adm-row">
          <label>
            Case diameter, mm (watches)
            <input name="case_diameter_mm" inputMode="decimal" maxLength={6} defaultValue={p?.case_diameter_mm ?? ""} placeholder="e.g. 36" />
          </label>
          <label>
            Movement (watches)
            <select name="movement" defaultValue={p?.movement ?? ""}>
              <option value="">Not set</option>
              <option value="automatic">Automatic</option>
              <option value="manual">Manual winding</option>
              <option value="quartz">Quartz</option>
            </select>
          </label>
          <label>
            Fineness / carat (jewellery)
            <input name="purity" maxLength={80} defaultValue={p?.purity ?? ""} placeholder="Only as documented, e.g. 18k, 925" />
          </label>
        </div>
        <label>
          Stones (jewellery — confirmed details only)
          <input name="stones" maxLength={300} defaultValue={p?.stones ?? ""} placeholder="e.g. Diamonds, 0.50 ct total (certificate no. …)" />
        </label>
        <label>
          Comes with (separate with commas)
          <input name="included" maxLength={800} defaultValue={p?.included?.join(", ") ?? ""} placeholder="e.g. Box, Dust bag, Receipt" />
        </label>
        <label>
          Documentation (facts only)
          <textarea name="authentication" rows={2} maxLength={1000} defaultValue={p?.authentication ?? ""} placeholder="e.g. Original receipt available to view" />
        </label>
        <p className="adm-small adm-muted">
          Write only what is documented. Never describe plated or costume jewellery as gold or as fine jewellery, and don’t claim official authorisation or a guarantee you
          can’t show.
        </p>
      </fieldset>

      {compliance && (
        <fieldset className="adm-fieldset">
          <legend>Information buyers must see (UAE)</legend>
          <p className="adm-muted adm-small">Cabinet Resolution 66/2023, Art. 40: country of origin, and the materials in Arabic as well as English. Both are shown on the product page. See Compliance.</p>
          <div className="adm-row">
            <label>
              Country of origin
              <input name="country_of_origin" maxLength={80} defaultValue={p?.country_of_origin ?? ""} placeholder="e.g. France" />
            </label>
          </div>
          <label>
            Materials in Arabic
            <textarea name="composition_ar" rows={2} maxLength={500} dir="rtl" lang="ar" defaultValue={p?.composition_ar ?? ""} placeholder="مثال: جلد توغو، معدن مطلي بالبلاديوم" />
          </label>
        </fieldset>
      )}

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
              placeholder="Leave empty: “Price on request”"
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
          <textarea name="delivery" rows={2} maxLength={1000} defaultValue={p?.delivery ?? ""} placeholder="Only what you actually offer for this piece." />
        </label>
        <label>
          Returns
          <textarea name="returns" rows={2} maxLength={1000} defaultValue={p?.returns ?? ""} />
        </label>
        <input type="hidden" name="featured_shown" value="1" />
        <label className="adm-check">
          <input type="checkbox" name="featured" defaultChecked={p?.featured ?? false} /> Show first in “New in” on the home page
        </label>
      </fieldset>
    </>
  );
}
