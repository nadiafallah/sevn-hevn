# Concierge chat and private panel

The website has a virtual-assistant chat for customers and a private panel for the SEVN HEVN team.

| What | Where |
| --- | --- |
| Chat, floating button on every page | “Concierge” button above the WhatsApp button |
| Chat, shareable page | `https://www.sevnhevn.ae/chat` (same chat and conversation as the button) |
| Private panel | `https://www.sevnhevn.ae/admin` |

The chat speaks English and Arabic (Arabic is shown right to left). It always says it is a virtual assistant, and WhatsApp, phone and “Talk to a person” are always one tap away.

## 1. What the chat does

A customer can:

1. ask us to **find a specific piece** (brand, model, colour, size, budget, delivery country, timing, and photos);
2. ask about **a piece, its price or availability, authenticity, delivery or returns**;
3. **follow up on an order**;
4. **ask for a call** from the team.

It asks one question at a time and skips anything the customer has already said (for example, “Hermès Birkin 25 in gold” fills brand, model, size, colour and category). Name, budget and unknown details are optional. A phone/WhatsApp number with its country code is required; numbers from every country are accepted.

Before anything is sent, the customer sees a summary and must tick a box agreeing to be contacted **about this request**. Marketing consent is never assumed. The request is saved in the database first. Only then does the customer get a reference (`REQ-XXXXXX`), and the team is notified. A double click, a retry or a dropped connection never creates a second request.

### What the chat will never do

- **Make up a price, discount, stock level, authenticity claim, warranty, return term, delivery time, shipping cost or customs cost.**
  - A price is quoted only when it is the website listing’s own price, with its date, and only if the listing changed in the last 30 days. Even then the chat adds that our team confirms availability and the final price.
  - Anything else becomes a request marked **“Needs your confirmation”** for the team.
- **Quote policy text that you haven’t approved.** It quotes only approved **Store knowledge** entries, word for word (see §4.5). Without one, it says it has no approved information and passes the question on.
- **Treat editorial (AI) images as pieces for sale.** It says they are mood images and offers to source something similar.
- **Treat a photo as proof.** It says a photo can’t confirm authenticity, availability or price.
- **Promise delivery to a country.** It records the destination and tells the customer the team confirms the options.
- **Show order details to someone who only knows the order number.** See §6.

## 2. Setting it up

### 2.0 One-time database setup (required; **pending as of 6 Oct 2026**)

The site checks once a minute whether the concierge database objects exist. Until they do:

- the Concierge button and the footer link are hidden;
- `/chat` says the online concierge isn’t available and offers WhatsApp and phone;
- the panel’s sign-in grants no access.

To set it up:

1. Open **Supabase → project `sevn-hevn` → SQL Editor**: `https://supabase.com/dashboard/project/amjgwnuroshdqrruasmn/sql/new`. Check the project name at the top.
2. Run the contents of `supabase/migrations/20261006120000_concierge_crm.sql`, followed by:

   ```sql
   -- the SHA-256 (hex) of the CONCIERGE_SERVER_KEY value stored in Vercel; the key itself never goes here
   insert into private.server_keys (name, sha256_hex) values ('concierge', '<sha256 of the key>');
   -- the owner's sign-in e-mail
   insert into public.staff_members (email, display_name, role) values ('<owner e-mail>', 'Owner', 'owner');
   ```

   On 6 Oct 2026 these were prepared in a single, tested file, `SEVN-HEVN-production-setup.sql`, on the owner’s Desktop. It is not in this repository because it contains the owner e-mail.
3. Within about a minute the button appears. No redeploy is needed.

The Supabase connector used by the assistant cannot run schema changes in its sessions, so this step is done in the dashboard.

### 2.1 Environment variables (Vercel → project `sevn-hevn` → Settings → Environment Variables)

Enter secret values yourself in Vercel, and tick **Sensitive**. Never paste them into chat, e-mail or files.

| Name | Environment | Purpose | State (6 Oct 2026) |
| --- | --- | --- | --- |
| `CONCIERGE_SERVER_KEY` | Production | The chat’s own limited database key. It can only call the chat’s functions. | **set** |
| `CRON_SECRET` | Production | Daily retry of unsent notifications | **set** |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` | Production | E-mail notifications and order codes | not set |
| `SMTP_PASSWORD` | Production, Sensitive | Mailbox password | not set |
| `WHATSAPP_*` | Production | WhatsApp notifications (§5.2) | not set |
| `CONCIERGE_AI_ENABLED`, `ANTHROPIC_API_KEY`, … | Production | Optional AI (§7) | off |

After adding or changing a variable, open **Deployments** → latest production deployment → **Redeploy**.

The chat runs only on the **production** deployment, where `CONCIERGE_SERVER_KEY` exists. Preview deployments and local development show “The online concierge isn’t available right now” with the WhatsApp and phone links. So no test or preview can write into customer data.

**Rotating the server key:**

1. Generate a new random value of 48 or more characters.
2. Put it in Vercel (Production, Sensitive).
3. In Supabase → SQL editor, run `update private.server_keys set sha256_hex = encode(sha256(convert_to('<new key>', 'UTF8')), 'hex') where name = 'concierge';` then clear the editor.
4. Redeploy.

### 2.2 First sign-in for the owner

The owner’s team entry is already created. To get in:

1. Open `https://www.sevnhevn.ae/admin/setup`. Enter the owner e-mail address and choose a password of at least 12 characters.
2. Supabase sends a confirmation e-mail. Open the link in it.
3. Sign in at `/admin/login`.

If the confirmation e-mail doesn’t arrive, add the user directly: **Supabase → Authentication → Users → Add user → Create new user**. Use the same e-mail, choose a password and tick **Auto Confirm User**. The first sign-in at `/admin/login` links the account to the team entry automatically.

Two Supabase settings are recommended. They are one-time changes, contain no secrets, and are made at **Supabase → Authentication**:

- **URL Configuration:**
  - Set **Site URL** to `https://www.sevnhevn.ae`.
  - Add `https://www.sevnhevn.ae/admin/**` to **Redirect URLs**.
  - Until then, the confirmation link still confirms the account, but afterwards the browser opens a page that doesn’t load. Password-reset links don’t work until this is set.
- **SMTP Settings:** use the `info@sevnhevn.ae` mailbox (same values as §5.1).
  - Supabase’s built-in sender only e-mails members of the Supabase organisation, a few times per hour.
  - Staff members need custom SMTP to receive their confirmation e-mail.

No one can sign up on their own. Only e-mail addresses the owner adds under **Team** can set up access. Accounts that aren’t on the team see nothing, and the database enforces this.

## 3. Roles

| | Owner | Staff |
| --- | --- | --- |
| See all requests, customers, conversations, photos and orders | ✓ | ✓ |
| Add notes, log call results, assign, set next action and follow-up date | ✓ | ✓ |
| Change request status (except “Converted to an order”) | ✓ | ✓ |
| Update delivery status, carrier and tracking on orders | ✓ | ✓ |
| Retry a failed notification | ✓ | ✓ |
| Record approved price / availability | ✓ | – |
| Create orders; change totals, currency, payment status and order status | ✓ | – |
| Edit customer details | ✓ | – |
| Store knowledge (approve, edit, retire) | ✓ | – |
| Team (add, change role, deactivate) | ✓ | – |
| Export CSV, delete requests permanently, activity log | ✓ | – |

These limits are enforced in the database itself, not only by hiding buttons.

- Signed-in accounts can only **read**, through row-level security.
- Every change goes through a database function. It checks the person’s role and writes the **activity log**: who, when, old value and new value.
- Staff can’t see team members’ e-mail addresses or the activity log.

## 4. Using the panel

### 4.1 Requests (home page of the panel)

The overview shows counts from real data only. Test records are excluded.

**Search** works on reference, name, phone digits, e-mail, request text and brand. You can **filter** by:

- status;
- type;
- who it’s assigned to;
- language;
- destination country;
- “Needs confirmation”.

Statuses:

| Status | Meaning |
| --- | --- |
| New | Just arrived |
| In progress | Someone is working on it |
| Waiting for price / availability approval | Needs the owner’s confirmation |
| Waiting for the customer | We replied and are waiting |
| Converted to an order | Set automatically when the owner records an order from the request |
| Closed | Finished, or no longer relevant |

### 4.2 A request

Each request page shows:

- **Customer:** name, phone, e-mail, preferred contact and the exact consent wording with its time.
  - **Open WhatsApp with the customer** opens WhatsApp with a short greeting in the customer’s language.
  - Nothing is sent until you press send in WhatsApp.
- **Request:** the customer’s own words, the details the chat collected and the destination.
- **Photos:** private. Each one opens through a link valid for 5 minutes, and only for signed-in team members.
- **Conversation:** the full chat transcript.
- **Follow-up:** status, assigned to, next action and follow-up date (Dubai time).
- **Notes and calls:** internal notes (never shown to the customer) and call results.
- **Price and availability (owner):** “Record a confirmed price / availability” stores the piece, availability, price with currency, an optional validity date and a note. Your name and the time are recorded with it.
  - The team uses it when replying. The chat never quotes it.
- **Orders:** “Create an order” (owner).
- **Team notifications:** e-mail and WhatsApp status: sent, failed (with the error), or “needs connection”. Use “Try again” after a failure.
- **History** and **Delete permanently** (owner): for spam, test data or a customer’s erasure request.

### 4.3 Orders

The owner creates an order from a request or a customer record:

- items (`description | brand | quantity`, one per line);
- approved total and currency;
- shipping destination;
- an optional note the customer may see;
- the **verification e-mail** (§6).

The order then has:

- a reference `ORD-XXXXXX`;
- payment status, kept separate from delivery status;
- carrier, tracking number and tracking link.

All changes are logged. Online payment is not part of this version, and the chat never asks for card details.

### 4.4 Customers

One record per phone number, with all of that customer’s requests and orders.

### 4.5 Store knowledge (owner)

This is the only policy text the chat may quote. Each entry has:

- topic (shipping, returns, authenticity, warranty, payment, viewing, general);
- language (English or Arabic);
- an optional country;
- title and text;
- **source** and an optional source link;
- an optional **“review by” date**. After that date the entry is no longer quoted.

Approving records your name and the time. **Editing an approved entry sends it back to draft**, so new wording is never quoted without approval.

At launch, four English entries are approved. They repeat the interim notices already published on the website: shipping & delivery, returns, independent reseller, and editorial images.

- In an Arabic conversation, an approved English entry is shown in English and clearly marked as English.
- Add and approve Arabic versions to answer in Arabic.
- Replace the interim wording when the final policies are approved.

### 4.6 Test data

Phone numbers in the UK Ofcom drama range `+44 7700 900000` to `+44 7700 900999` are never given to real people. Requests that use them are marked **Test**. They:

- are hidden unless “Include test records” is ticked;
- are left out of statistics;
- carry “[TEST]” in notification e-mails.

Delete them from the request page when you no longer need them.

## 5. Notifications

The request is always saved first. Notifications go out right after, and they are retried:

- automatically with backoff (up to 5 attempts);
- daily by Vercel Cron;
- by hand with “Try again”.

They contain only:

- the reference;
- the type and language;
- the destination;
- what needs confirmation;
- a link to the panel.

No customer name, phone number or photos are included.

### 5.1 E-mail (recommended first: no extra cost)

This uses the existing `info@sevnhevn.ae` mailbox on Host Arabia (cPanel → Email Accounts → Connect Devices shows the values). Set these in Vercel (Production):

| Name | Value |
| --- | --- |
| `SMTP_HOST` | `mail.sevnhevn.ae` (or the host cPanel shows) |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `info@sevnhevn.ae` |
| `SMTP_PASSWORD` | the mailbox password (**Sensitive**) |
| `NOTIFY_EMAIL_TO` | `info@sevnhevn.ae` |
| `NOTIFY_EMAIL_FROM` | `SEVN HEVN <info@sevnhevn.ae>` |

Then:

1. Redeploy.
2. In the panel, open **Settings → Send a test email**.

Turning on e-mail also turns on:

- order-status checks in the chat (§6);
- the retry of notifications that were waiting for a connection, if they are less than 7 days old.

### 5.2 WhatsApp (needs the official WhatsApp Business Platform)

Opening `wa.me` links, or having the WhatsApp Business app, is not an automated connection. Automatic alerts need Meta’s **WhatsApp Business Platform (Cloud API)**:

1. A Meta Business portfolio (business verification may be required) and a WhatsApp Business Account.
2. A phone number registered with the Cloud API. Moving +971 52 887 7200 from the WhatsApp Business app to the API changes how that number works in the app. Decide this carefully, or use a separate number.
3. An approved **utility** message template with two body variables: `{{1}}` = request reference, `{{2}}` = panel link.
4. A permanent (system-user) access token.
5. In Vercel (Production):
   - `WHATSAPP_ACCESS_TOKEN` (Sensitive);
   - `WHATSAPP_PHONE_NUMBER_ID`;
   - `WHATSAPP_NOTIFY_TO`: the team member’s own WhatsApp number that receives the alerts;
   - `WHATSAPP_TEMPLATE_NAME`;
   - optional `WHATSAPP_TEMPLATE_LANG` (default `en`) and `WHATSAPP_GRAPH_VERSION` (default `v26.0`).

Meta charges per template message, at rates that depend on the country. Check Meta’s current pricing before enabling.

Until this is connected, WhatsApp shows **“Needs connection”** on each request. Nothing is lost: the request is in the panel and e-mail can carry the alerts.

This version does **not** include a chatbot inside WhatsApp itself.

## 6. Order status in the chat

Knowing an order number (or a phone number) is never enough to see an order. When a customer asks:

1. The chat asks for the order reference.
2. If e-mail is connected, it sends a **6-digit code** to the **verification e-mail recorded on that order** by the owner. The code:
   - expires after 10 minutes;
   - works once;
   - allows 5 attempts;
   - only works in the conversation that asked for it.

   The chat gives the same answer whether or not the order exists.
3. After the code, the customer sees only:
   - status, payment status and delivery status;
   - tracking;
   - the items;
   - the approved total;
   - the note you wrote for the customer.

   They never see internal notes, staff names or other customers.
4. Without e-mail, or for an order with no verification e-mail, the chat shows no details. It records an **order follow-up** request for the team instead.

## 7. Optional AI assistance (off)

The chat works fully without AI. If you turn it on, AI is used for two narrow, read-only jobs:

- reading the details a customer wrote, such as “the black Kelly 28 from the film”;
- briefly describing a photo, which the chat then asks the customer to confirm.

It has no tools. It can’t see the database, prices, policies or other customers, and it can’t change anything. Its answers are checked against a fixed format, and customer text and photos are treated as data, not instructions. If the AI provider fails or runs out of budget, the chat simply asks its normal questions.

**Cost:** Anthropic API usage is billed per token. It is not part of any Claude subscription. Estimates:

| Model | Price per 1M tokens (input / output) | Roughly per conversation |
| --- | --- | --- |
| Claude Opus 5.5 (`claude-opus-5-5`, default) | US$4 / US$20 | about US$0.02–0.05 |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | US$1 / US$5 | about a quarter of that |

Built-in limits: 6 AI calls per conversation and 300 per day (`CONCIERGE_AI_PER_CONVERSATION`, `CONCIERGE_AI_PER_DAY`). At the default limits the worst case is about US$15 a day with Opus 5.5.

**To enable:**

1. Create an API key at console.anthropic.com and set a monthly spend limit there.
2. Add to Vercel (Production):
   - `ANTHROPIC_API_KEY` (Sensitive);
   - `CONCIERGE_AI_ENABLED=true`;
   - optionally `CONCIERGE_AI_MODEL`.
3. Add a line to the privacy notice (`src/content/policies.ts`) saying that chat text and photos may be processed by Anthropic to understand requests.
4. Redeploy.

## 8. Security and privacy (summary)

**Database and accounts**

- Deny by default. Visitors (the public key) can’t read or write any customer table.
- The chat’s server key can only call the chat’s functions. These validate every field and are rate-limited per visitor and site-wide.
- Each conversation has its own random token. Only its SHA-256 is stored, so changing an id in a request gets nothing.
- Panel sessions use httpOnly, Secure, SameSite cookies. Sign-in is rate-limited.

**Photos**

- Only real JPEG, PNG and WebP images are accepted, up to 4 MB after the browser scales them.
- At most 3 photos per conversation.
- Each photo is re-encoded on the server, which removes GPS and camera data.
- Photos are stored in the private `request-photos` bucket and shown to the team through 5-minute links.

**Logs**

- No secrets, tokens or customer messages are written to logs or to Git.
- Only a salted hash of the visitor’s IP is kept, for rate limiting.

The privacy notice (`/#privacy`) describes the chat.

## 9. Database, migrations and rollback

The migration is `supabase/migrations/20261006120000_concierge_crm.sql`. It is additive: new tables, functions, policies, a private bucket and the knowledge seed. The rollback is `supabase/rollbacks/20261006120000_concierge_crm.down.sql`. The rollback **deletes all concierge data**, so export first and get written approval.

| Tables | Purpose |
| --- | --- |
| `staff_members` | Team list and roles |
| `customers`, `requests`, `request_photos`, `request_notes` | Customers and their requests |
| `conversations`, `conversation_messages` | Chat transcripts |
| `price_approvals` | Owner-approved price and availability |
| `orders`, `order_items`, `order_access_challenges` | Orders and order-status codes |
| `knowledge_entries` | Approved store knowledge |
| `notifications` | Notification outbox |
| `audit_log` | Activity log |
| `private.*` (not exposed) | Server key hash, rate limits, AI usage |

New changes always go in a new migration file. Never edit an applied one.

## 10. Tests

| Command | What it checks |
| --- | --- |
| `npm run db:test` | All migrations on in-process Postgres 17: access rules for visitors, non-team accounts, staff and owner; order privacy; rate limits; idempotency; uploads; the notification outbox; the audit trail |
| `npm run test:unit` | The conversation in English and Arabic: no re-asking, unknown price handling, approved-only policy text, order verification, AI failure fallback, phone and country checks |
| `tests/e2e/run.sh` | A real browser against a production build on a local Postgres + PostgREST stack (`scripts/local-stack.mjs`, with stand-ins for Supabase Auth, Storage and SMTP). See the list below. |

The `tests/e2e/run.sh` run checks:

- desktop widget and mobile Arabic `/chat`, with a photo whose GPS data is removed;
- reload persistence;
- double submit;
- upload limits;
- owner and staff panels;
- server-side refusal of staff actions;
- verified order status;
- e-mail failure and retry;
- the rest of the site;
- accessibility scan (axe-core).

It needs `brew install postgresql@17 postgrest`.

## 11. Next steps (prioritised)

1. Connect e-mail (§5.1). This turns on e-mail alerts and order checks.
2. Approve Arabic store-knowledge entries, then replace the interim policies with the final ones.
3. Connect WhatsApp alerts (§5.2) if wanted.
4. Real inventory in Supabase. Listed prices are then quoted with their date.
5. Optional AI (§7), after setting a spend limit.
6. Later:
   - live stock sync;
   - a weekly e-mail summary of requests;
   - request analytics (sources, brands, conversion);
   - saved replies for staff;
   - reminders for due follow-ups;
   - a customer-facing order page with sign-in links;
   - payment links once a provider is chosen.
