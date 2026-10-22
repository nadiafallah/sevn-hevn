# Orders: from quote to delivery, returns and refunds

How an order moves through the shop, who may do what, what must be set up before online payment, and the decisions still open. October 2026. Database: `supabase/migrations/20261022120000_order_lifecycle.sql`.

## 1. One record per order

Every sale is one order in the panel (`/admin/orders`), whether it starts at the website checkout, on WhatsApp, by phone or in person. Enquiries stay in **Requests** until the owner turns one into a quote, so an enquiry is never mistaken for an order.

An order keeps four separate statuses. None of them is typed in by hand:

| Status | Values | Changed by |
| --- | --- | --- |
| Order | Draft quote → Quote sent (waiting for the customer) → Confirmed → In progress → Completed, or Cancelled | the owner's actions, and payment in full |
| Payment | Unpaid, Payment pending, Partly paid, Paid, Payment failed, Partly refunded, Refund pending, Refunded, Refund failed | worked out from the payments and refunds themselves |
| Delivery | Not started, Waiting for stock, Sourcing, Quality check, Packed, Ready to dispatch, then Shipped, In transit, Out for delivery, Delivered, Collected, Delivery problem, Returned to sender | the team before dispatch. After that only shipments set it (carrier scan, proof of delivery) |
| Return (per return) | Requested, Under review, Approved / Rejected, Waiting for collection, On its way back, Received, Inspected, Resolved | the team for logistics; the owner for the decision and the outcome |

Every change is recorded in the order's **History** with the time, who or what made it (owner, staff, customer, payment provider, system) and the reason. The owner also sees the activity log.

The reference (`ORD-XXXXXX`) stays the same from the first quote to the end. Returns are `RET-…`, refunds `RFD-…`, payments `PAY-…`, shipments `SHP-…`.

## 2. Two ways an order starts

### 2.1 Website checkout (in-stock pieces)

1. The bag is checked on the server again (price, stock, version).
2. **When online payment is on** (see §5), the payment step shows the real amounts: the pieces, delivery for the destination, VAT (included or added, or zero-rated for exports), import duties for international orders, and the total. The customer accepts the approved terms of sale and returns policy, and goes to the payment provider's secure page.
3. The order is created as *Quote sent · waiting for the customer*. The piece is **held** for the customer (30 minutes by default) so nobody else can buy the last unit.
4. The order becomes **Paid** and **Confirmed** only when the provider's signed event arrives (`/api/payments/webhook`). A customer returning to the site, or a screenshot of a receipt, proves nothing. If the customer closes the tab before coming back, the event still confirms the order.
5. **When online payment is off** (today), checkout sends a purchase request to Requests, exactly as before. Nothing is charged.

### 2.2 Quote (WhatsApp, phone, in person, sourcing)

1. From a request or a customer record: **Create an order**. This makes a *draft quote*: pieces (in stock or on request), prices, discount, shipping, the VAT treatment, duties, delivery estimate and cancellation terms.
2. **Send the quote** fixes the amounts. It works only when everything the customer pays is known. For pieces on request it also needs the delivery estimate and the cancellation terms. In-stock catalogue pieces are held until the quote expires (72 hours by default).
3. **Create a link** (Customer section) and send it to the customer. The link opens their private order page, where they accept the quote and the policies.
4. Payment. Online, once a provider is connected. Or by bank transfer: the owner records it **after seeing the funds in the account**. Staff can note what a customer says they paid; it counts for nothing until the owner verifies it.
5. Paid in full → confirmed automatically. Pieces on request get a **sourcing task**. The full amount is paid before sourcing starts (owner decision, 22 Oct 2026).

The owner can confirm before full payment only with a written reason, which goes into the history.

## 3. After confirmation

| Step | What the panel requires |
| --- | --- |
| Sourcing | A task per piece on request: supplier (internal only), confirm-by date (an alert after it), expected date. "Supplier can't deliver" needs a reason; the piece then waits for the owner: try another supplier, or cancel and refund. |
| Quality check | A person checks every piece: serial or reference against the documents, condition as described, accessories, authenticity evidence. **Passing needs at least one photo** of the piece. A failed check needs a reason and alerts the team. |
| Packing | Every piece passed its check. |
| Shipment | Pieces in the parcel, carrier, tracking number, declared value, insurance, delivery requirements, the contents as packed and **packing photos**. A label alone is not "shipped". |
| Handover | A carrier scan or a signed handover. Without the carrier's confirmation of cover for that value and destination, only the owner can send it, with a reason. |
| Delivery | "Delivered" needs the carrier's proof of delivery (its reference in the note), or the owner's documented exception. Delays, failed attempts, address problems, customs, damage, loss and return to sender are recorded as problems and appear in the queue. A message for the customer can explain the delay on their page. |
| Collection in Dubai | What was checked at handover (ID, signature). |

Partial shipments work: each parcel lists its pieces, and the order is *Delivered* only when every piece is.

Photos and documents go to a **private** storage bucket. Only the team can open them, through links that expire after 10 minutes. Location data is removed from photos.

## 4. Cancellation, returns, refunds

These are separate on purpose.

- **Cancellation** (owner): only before anything has left with the carrier. Holds are released and pieces taken out of stock go back into stock. Money already paid is **not** treated as refunded; the order appears under *Refunds owed* until a refund is confirmed. Customers can ask to cancel from their order page; that arrives as a message for the team.
- **Return**: the customer asks from their order page (delivered pieces only), or the team opens one for them. The system notes the days since delivery, whether a change-of-mind request is inside the window, and whether the piece was sourced. This is advice for the owner, not a decision. The owner approves, or rejects with a reason **and** the way to ask for a review (both shown to the customer). Then: collection → received → **inspection** (photos, same piece, condition) → only now can it go back into stock → outcome: refund, replacement, repair, or sent back. A refund outcome needs the refund confirmed first.
- **Refund** (owner): against one captured payment, never more than is left of it, with the amounts for the pieces, original shipping and VAT, and any deduction kept apart (deductions need a reason and must be agreed and lawful). Online payments are refunded through the provider and stay **Refund pending** until the provider confirms. A refund that goes another way (bank transfer, …) is an exception with a written reason, and the owner records the confirmed result. A double click makes one refund, not two.
- **Consignment or resale** of a customer's piece is a separate agreement and never replaces a refund that is owed.

## 5. Before online payment can be switched on

All of these, then checkout shows *Pay securely* by itself (Settings → Shop rules shows what is missing):

1. **A payment provider with a merchant account** (Stripe, Network International, Checkout.com, Tap, …) that supports a hosted checkout, refunds through its API and signed webhooks. Only methods approved for the account, country and order values may be offered; an instalment logo doesn't mean every bag qualifies. The provider's adapter is added in `src/lib/payments/index.ts` (one file) and tested in its test mode first. Keys go in Vercel → Production only.
2. **VAT**: rate and whether listed prices include VAT, confirmed by your accountant (Settings → Shop rules). The TRN is printed on invoices once invoicing is added.
3. **Shipping zones**: countries, fee per parcel, transit days, VAT treatment (standard, or zero-rated exports) and who pays import duties. A destination without a zone (or without a fee) can't be paid online; the customer sends a request instead.
4. **Approved terms of sale and returns policy** (Settings → Policies), reviewed for the UAE and the countries you ship to. The order records the versions the customer accepted.
5. **Order e-mails**: connect the info@sevnhevn.ae mailbox (SMTP), read the wording below, then tick "Send customers order e-mails".

Customer e-mails (sent only when switched on; each carries a fresh private link and no prices or details):

| When | Subject | Text |
| --- | --- | --- |
| Confirmed | Your order ORD-… is confirmed | Thank you. We have received your payment and confirmed your order. |
| Handed to the carrier | Your order ORD-… is on its way | Your order has been handed to the carrier. The tracking details are on your order page. |
| Delivered | Your order ORD-… has been delivered | The carrier has confirmed delivery. If anything isn't right, you can tell us from your order page. |
| Cancelled | Your order ORD-… has been cancelled | Your order has been cancelled. If you have paid, your order page shows the refund once it has been sent. |
| A team update or reply | An update on your order ORD-… | Our team has posted an update on your order. |
| Refund confirmed | Your refund for order ORD-… | Your refund has been completed. The amount is shown on your order page. |
| Return approved / not accepted / complete | Your return RET-… is approved · About your return request RET-… · Your return RET-… is complete | (one sentence each, the decision and reason are on the page) |

WhatsApp messages to customers need the WhatsApp Business Platform with approved templates; they are not built. The "Open WhatsApp" links send nothing by themselves.

## 6. Who may do what

| | Owner | Staff |
| --- | :-: | :-: |
| See every order, customer, payment, refund, return, evidence and the history | ✓ | ✓ |
| Create and edit quotes (prices, discount, shipping, VAT, duties, terms), send, reopen | ✓ | – |
| Confirm an order; confirm before full payment (with a reason) | ✓ | – |
| Record a payment as received (after seeing the funds); verify or reject a reported one | ✓ | – |
| Note a payment the customer reports (waits for the owner) | ✓ | ✓ |
| Cancel an order | ✓ | – |
| Approve, settle or cancel refunds | ✓ | – |
| Decide returns (approve / reject) and close them | ✓ | – |
| Sourcing tasks, quality checks, photos and documents, packing, shipments, handover, carrier updates | ✓ | ✓ |
| Mark delivered on the carrier's proof | ✓ | ✓ |
| Mark delivered as an exception, mark lost, send without confirmed cover | ✓ | – |
| Return logistics, inspection, restock after a passed inspection | ✓ | ✓ |
| Messages and updates to the customer, customer links (create / revoke) | ✓ | ✓ |
| Settings: VAT, returns window, holds, alerts, shipping zones, policies, customer e-mails | ✓ | – |
| Resolve payment events that didn't match | ✓ | – |

The database checks every one of these (the panel only hides what isn't allowed). Staff can't write to any table directly.

## 7. Work queues

On **Orders**: paid but not confirmed (a piece went out of stock first), payment events to check, payments to verify, waiting for the customer (with expiry), customer messages, refunds owed, refunds in progress or failed, sourcing (overdue supplier confirmations, late pieces), supplier can't deliver, pieces to check, overdue dispatch (after *n* days, Settings), delivery problems, returns to review, returns in progress.

## 8. The customer's order page

`https://www.sevnhevn.ae/order#t=…`: the private link from the team or from an order e-mail. The part after `#` never reaches a server log. The page takes it out of the address bar and keeps it for that browser tab only. An order number alone opens nothing. A link can be revoked, and expires (60 days by default).

The page shows: the pieces and their stage, the amounts (VAT, duties, paid, refunded, still to pay), the delivery estimate kept apart from the transit time, tracking, the history (with the team's explanations of any delay), returns and their outcome, and the accepted policy versions. The customer can accept a quote, pay online (once possible), write to the team, ask to cancel before dispatch and request a return.

## 9. Settings, environment variables, services

| Variable (Vercel → Production) | For | State |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CONCIERGE_SERVER_KEY` | database (already set) | set |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` | team alerts, customer e-mails, chat order checks | **not set** (mailbox password needed) |
| `CRON_SECRET` | the daily job (`/api/cron/notifications`): retries messages, tidies expired holds, re-sends approved provider refunds | set |
| Provider keys (names depend on the provider chosen) | online payment, refunds, webhook signature | **no merchant account yet** |
| `PAYMENTS_TEST_PROVIDER`, `PAYMENTS_TEST_SECRET` | the **local test stack only**; refused on every Vercel deployment | — |

Services: Supabase (database, private file storage) and Vercel, as today. A payment provider adds its own fees (see its official pricing once chosen). E-mail uses the existing mailbox. Nothing here starts a new subscription.

## 10. Open decisions for the owner

These stay switched off or "confirmed with you" until decided. The software doesn't invent them:

1. **Payment provider** and merchant account (§5.1).
2. **VAT**: rate, whether listed prices include VAT, treatment of exports and of shipping charges, and the tax invoice (with the TRN). Confirm with your accountant.
3. **Shipping**: countries and zones, fees, carriers, insurance for high-value parcels (written confirmation of cover per destination), who pays import duties.
4. **Returns policy text**: change-of-mind window in days (you said yes for in-stock pieces) and conditions (unworn, tags, packaging); whether sourced or pre-owned pieces can be returned on change of mind; who pays return shipping; deadlines to report faults or damage; how long the review takes and when refunds are started.
5. **Terms of sale**: cancellation cut-off for in-stock orders; what happens when a supplier fails or a promised date is missed (the per-quote cancellation terms cover sourced pieces today); lost or failed deliveries; disputes.
6. **Quote validity and hold times** (defaults: 72 hours, 30 minutes).
7. Wording of the **customer e-mails** (§5).
8. Have the terms and returns policy reviewed for the UAE (and the destinations you ship to) before approving them. Nothing in the system limits a customer's statutory rights.

## 11. Deploy and roll back

- Code: through the usual pull request and Vercel preview. Previews have no database access, so the order features show as unavailable there. The local test stack (`tests/e2e/run.sh`) covers them end to end.
- Database: `supabase/migrations/20261022120000_order_lifecycle.sql`, run once in the Supabase SQL Editor. It requires the three earlier shop migrations (in the one-file update the owner was given on 22 Oct 2026). Existing orders are kept and their status is mapped across.
- Rollback: `supabase/rollbacks/20261022120000_order_lifecycle.down.sql` removes the new tables, **with their data** (export first). It puts the first panel's order functions back and maps statuses back. Then revert the code.

## 12. Not built yet

- A connected payment provider (needs the merchant account), and carrier integrations: labels and tracking updates are entered by hand for now.
- Tax invoices (needs the accountant's confirmation of the VAT details and the invoice format).
- Customer photos with a return request (the team asks for them by message for now).
- WhatsApp messages to customers (needs the WhatsApp Business Platform and approved templates).
- The AI assistant for orders: the chat already shows an order's status after an e-mailed code. An assistant that explains policy, looks up an authenticated customer's order, collects sourcing and return requests and drafts replies for the team comes after the above. It would never set prices, approve returns or issue refunds; its tools would not allow it.
