import { channelLabels, dutiesLabels, vatTreatmentLabels } from "@/lib/admin/labels";

export interface LineDefaults {
  description?: string;
  brand?: string | null;
  product_ref?: string | null;
  sku?: string | null;
  options?: string | null;
  quantity?: number;
  unit_amount?: string | number | null;
  availability?: string;
  condition?: string | null;
  condition_notes?: string | null;
  included?: string[];
}

export interface QuoteDefaults {
  channel?: string;
  currency?: string;
  discount_amount?: string | number | null;
  shipping_amount?: string | number | null;
  delivery_mode?: string;
  shipping_country?: string | null;
  shipping_address?: string | null;
  shipping_destination?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  vat_treatment?: string;
  duties_treatment?: string;
  duties_note?: string | null;
  cancellation_terms?: string | null;
  sourcing_eta?: string | null;
  transit_days_min?: number | null;
  transit_days_max?: number | null;
  delivery_estimate_from?: string | null;
  delivery_estimate_to?: string | null;
  delivery_estimate_note?: string | null;
  customer_note?: string | null;
  contact_email?: string | null;
}

const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));

/**
 * The lines and terms of a quote (owner). VAT is never typed in: the database works it out from the
 * treatment chosen here and the rate in Settings. Blank lines are ignored.
 */
export function QuoteFields({ lines, q, vatRate }: { lines: LineDefaults[]; q: QuoteDefaults; vatRate: string | null }) {
  const rows = [...lines, ...Array.from({ length: Math.max(1, 3 - lines.length) }, () => ({}) as LineDefaults)];
  return (
    <>
      <fieldset className="adm-fieldset">
        <legend>Pieces</legend>
        <p className="adm-muted adm-small">
          A product code (SH-0001) and version code link the line to the catalogue, so an in-stock piece is held for the customer while the quote is open.
          “On request” lines are sourced after the customer has paid.
        </p>
        {rows.map((l, i) => (
          <div key={i} className="adm-card adm-line">
            <div className="adm-row">
              <label>Description<input name={`item_description_${i}`} defaultValue={v(l.description)} maxLength={300} /></label>
              <label>House<input name={`item_brand_${i}`} defaultValue={v(l.brand)} maxLength={80} /></label>
            </div>
            <div className="adm-row">
              <label>Product code<input name={`item_ref_${i}`} defaultValue={v(l.product_ref)} maxLength={40} pattern="[A-Za-z0-9-]{2,40}" /></label>
              <label>Version code<input name={`item_sku_${i}`} defaultValue={v(l.sku)} maxLength={48} pattern="[A-Za-z0-9-]{2,48}" /></label>
              <label>Colour / size / hardware<input name={`item_options_${i}`} defaultValue={v(l.options)} maxLength={200} /></label>
            </div>
            <div className="adm-row">
              <label>Quantity<input name={`item_quantity_${i}`} type="number" min={1} max={50} defaultValue={l.quantity ?? 1} /></label>
              <label>Unit price<input name={`item_unit_${i}`} inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" defaultValue={v(l.unit_amount)} /></label>
              <label>
                Availability
                <select name={`item_availability_${i}`} defaultValue={l.availability ?? "in_stock"}>
                  <option value="in_stock">In stock</option>
                  <option value="on_request">On request (sourced after payment)</option>
                </select>
              </label>
            </div>
            <div className="adm-row">
              <label>Condition<input name={`item_condition_${i}`} defaultValue={v(l.condition)} maxLength={40} placeholder="new, excellent, …" /></label>
              <label>Condition notes<input name={`item_condition_notes_${i}`} defaultValue={v(l.condition_notes)} maxLength={500} /></label>
              <label>Included (comma-separated)<input name={`item_included_${i}`} defaultValue={(l.included ?? []).join(", ")} maxLength={400} placeholder="box, dust bag, receipt" /></label>
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Amounts</legend>
        <div className="adm-row">
          <label>Currency<input name="currency" defaultValue={q.currency ?? "AED"} maxLength={3} pattern="[A-Za-z]{3}" required /></label>
          <label>Discount<input name="discount_amount" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" defaultValue={v(q.discount_amount ?? "")} /></label>
          <label>Shipping<input name="shipping_amount" inputMode="decimal" pattern="[0-9,]+(\.[0-9]{1,2})?" defaultValue={v(q.shipping_amount)} placeholder="empty: not quoted yet" /></label>
        </div>
        <div className="adm-row">
          <label>
            VAT
            <select name="vat_treatment" defaultValue={q.vat_treatment ?? "unknown"}>
              {Object.entries(vatTreatmentLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
          <label>
            Import duties
            <select name="duties_treatment" defaultValue={q.duties_treatment ?? "unknown"}>
              {Object.entries(dutiesLabels).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
        </div>
        <p className="adm-muted adm-small">{vatRate ? `Standard VAT uses ${vatRate}% from Settings, worked out by the system.` : "Set the VAT rate in Settings before choosing standard VAT."}</p>
        <label>Duties note shown to the customer<input name="duties_note" defaultValue={v(q.duties_note)} maxLength={400} /></label>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Delivery</legend>
        <div className="adm-row">
          <label>
            How
            <select name="delivery_mode" defaultValue={q.delivery_mode ?? "deliver"}>
              <option value="deliver">Delivery</option>
              <option value="collect">Collect in Dubai</option>
            </select>
          </label>
          <label>Country (2 letters)<input name="shipping_country" defaultValue={v(q.shipping_country)} maxLength={2} pattern="[A-Za-z]{2}" /></label>
          <label>Ship-to label<input name="shipping_destination" defaultValue={v(q.shipping_destination)} maxLength={160} placeholder="Dubai, AE" /></label>
        </div>
        <label>Address<input name="shipping_address" defaultValue={v(q.shipping_address)} maxLength={400} /></label>
        <div className="adm-row">
          <label>Recipient<input name="recipient_name" defaultValue={v(q.recipient_name)} maxLength={80} /></label>
          <label>Recipient phone (+971…)<input name="recipient_phone" defaultValue={v(q.recipient_phone)} maxLength={16} pattern="\+[1-9][0-9]{6,14}" /></label>
        </div>
        <div className="adm-row">
          <label>Piece expected in hand<input name="sourcing_eta" type="date" defaultValue={v(q.sourcing_eta)} /></label>
          <label>Transit days (from)<input name="transit_days_min" type="number" min={0} max={90} defaultValue={v(q.transit_days_min)} /></label>
          <label>Transit days (to)<input name="transit_days_max" type="number" min={0} max={90} defaultValue={v(q.transit_days_max)} /></label>
        </div>
        <div className="adm-row">
          <label>Delivery estimate from<input name="delivery_estimate_from" type="date" defaultValue={v(q.delivery_estimate_from)} /></label>
          <label>Delivery estimate to<input name="delivery_estimate_to" type="date" defaultValue={v(q.delivery_estimate_to)} /></label>
        </div>
        <label>Estimate, in words (shown to the customer)<input name="delivery_estimate_note" defaultValue={v(q.delivery_estimate_note)} maxLength={300} placeholder="Sourcing 7–14 days, then 2–4 days in transit" /></label>
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend>Terms and customer</legend>
        <label>
          Channel
          <select name="channel" defaultValue={q.channel ?? "panel"}>
            {Object.entries(channelLabels).filter(([k]) => k !== "website").map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label>Cancellation terms (shown with the quote; needed for on-request pieces)<textarea name="cancellation_terms" rows={2} defaultValue={v(q.cancellation_terms)} maxLength={1000} /></label>
        <label>Customer e-mail (order updates and chat order checks)<input name="contact_email" type="email" defaultValue={v(q.contact_email)} maxLength={254} /></label>
        <label>Note shown to the customer<input name="customer_note" defaultValue={v(q.customer_note)} maxLength={600} /></label>
      </fieldset>
    </>
  );
}
