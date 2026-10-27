# Compliance: the UAE rules the shop follows

The shop keeps a ledger of the UAE rules that apply to selling online: returns and refunds, what buyers must see before they pay, VAT and the profit margin scheme for pre-owned pieces, e-invoicing, insurance, anti-money-laundering for jewellery and watches, personal data and penalties. Each rule has its official source. A weekly monitor keeps the ledger current, and the owner approves every change.

This is not legal advice. Before approving a change to tax or return terms, ask the shop's lawyer or accountant.

## Where to see it

**Private panel → Compliance** (`/admin/compliance`, owner only). It shows:

- **Waiting for your decision**: changes the monitor found, most important first, in English and Persian, with the evidence link and the exact values that change. **Approve** or **Reject** each one.
- **Rules**: every rule by topic, with how certain it is (*Confirmed*, *Sources disagree*, *Ask a lawyer*, *Not yet verified*), what the website must do, the numbers the website reads (for example `defect window days: 30`) and whether it has been checked against the official text.
- **Official sources checked every week**, with the last result.
- **Weekly checks**: each run and its report.
- **Decided**: past decisions and notes.

The data is in Supabase (project `sevn-hevn`), tables `compliance_rules`, `compliance_sources`, `compliance_runs` and `compliance_changes`. Only the team can read them, and nobody can change them through the API.

## How it stays current

A scheduled task, **"Seven Heaven compliance monitor"**, runs every **Monday at 08:31 Dubai time** (set up in Claude, not in this repository). Each run:

1. Applies the owner's decisions from replies to earlier report emails.
2. Checks up to 8 rules against the official text (uaelegislation.gov.ae, u.ae, MoET, FTA, MoF, DET, TDRA, UAEFIU) and proposes a correction or a "checked" mark.
3. Checks every official source for new laws, amendments, guides and deadlines.
4. Records each real change in `compliance_changes` as *waiting*. It never edits a rule itself.
5. Emails the owner a short Persian report: what changed, with a reference such as `CHG-7K3M9Q`, and upcoming deadlines.

## Approving a change

Either:

- **In the panel**: Compliance → Approve or Reject (with an optional note), or
- **By email**: reply to the weekly report with `تأیید CHG-XXXXXX` (approve), `رد CHG-XXXXXX` (reject) or `تأیید همه` (approve everything in that report). English works too: `approve CHG-XXXXXX`, `reject CHG-XXXXXX`, `approve all`. The next weekly run applies it.

Approving runs `private.compliance_decide`: an amendment updates the rule, a new rule is added, a repeal retires the rule, a check marks it as verified. Every decision goes to the activity log. A change can be decided once.

## What it does not do yet

The website does not read these rules yet. The returns, terms and privacy texts in `src/content/policies.ts` are unchanged, and checkout does not yet use the return windows or thresholds. That is the next step: checkout, the returns policy and invoices read `site_params` from the active rules, after the owner approves the final policy wording.

## Files

| What | File |
| --- | --- |
| Tables, access rules, decision function | `supabase/migrations/20261027191858_compliance.sql` (applied in production 27 Oct 2026) |
| Starting rules and sources | `supabase/seeds/compliance_rules.sql` (applied in production; only for a fresh database) |
| Undo | `supabase/rollbacks/20261027191858_compliance.down.sql` (deletes the ledger; export first) |
| Tests | `supabase/tests/compliance.test.mjs` (`npm run db:test`) |
| Panel page | `src/app/admin/(panel)/compliance/page.tsx`, action `decideComplianceChange` in `src/app/admin/actions.ts` |
