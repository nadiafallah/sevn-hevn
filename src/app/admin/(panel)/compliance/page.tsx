import { select } from "@/lib/concierge/db";
import { requireOwner } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import {
  appliesToLabels,
  certaintyLabels,
  changeStatusLabels,
  changeTypeLabels,
  complianceAreaLabels,
  day,
  severityLabels,
  when,
} from "@/lib/admin/labels";
import { siteCoverage, type CoverageState } from "@/lib/compliance-rules";
import { getSiteRules } from "@/lib/compliance";
import { decideComplianceChange } from "../../actions";

export const metadata = { title: "Compliance" };

interface Rule {
  id: string;
  code: string;
  area: string;
  title_en: string;
  title_fa: string;
  requirement_en: string;
  requirement_fa: string;
  applies_to: string[];
  site_action: string;
  site_params: Record<string, unknown>;
  law_reference: string;
  source_url: string;
  certainty: string;
  status: string;
  effective_from: string | null;
  last_verified_at: string | null;
  notes: string | null;
}

interface Change {
  id: string;
  ref: string;
  rule_id: string | null;
  change_type: string;
  severity: "low" | "medium" | "high";
  summary_en: string;
  summary_fa: string;
  evidence_url: string;
  proposed: Record<string, unknown>;
  status: string;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface Source {
  id: string;
  name: string;
  authority: string;
  url: string;
  watch_for: string;
  active: boolean;
  last_checked_at: string | null;
  last_snapshot: string | null;
  last_result: string | null;
}

interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  sources_checked: number;
  changes_found: number;
  report: string | null;
  error: string | null;
}

const severityOrder = { high: 0, medium: 1, low: 2 };
const coverageLabels: Record<CoverageState, string> = { live: "On the website", partial: "Partly", not_yet: "Not yet", off_site: "Outside the website" };
const coverageOrder: Record<CoverageState, number> = { not_yet: 0, partial: 1, live: 2, off_site: 3 };
const resultLabels: Record<string, string> = { no_change: "No change", change_found: "Change found", unreachable: "Couldn’t reach" };

const label = (map: Record<string, string>, key: string) => map[key] ?? key.replaceAll("_", " ");

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return /^https:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

/** The numbers and switches the website reads from a rule. */
function Params({ params }: { params: Record<string, unknown> }) {
  const entries = Object.entries(params ?? {});
  if (!entries.length) return null;
  return (
    <dl className="adm-dl adm-small">
      {entries.map(([k, v]) => (
        <div key={k} className="adm-dl__row">
          <dt>{k.replaceAll("_", " ")}</dt>
          <dd>{Array.isArray(v) ? v.map(String).join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Decide({ id }: { id: string }) {
  return (
    <div className="adm-actions">
      <form action={decideComplianceChange} className="adm-inline">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="approved" />
        <input name="note" placeholder="Note (optional)" maxLength={300} aria-label="Approval note" />
        <button type="submit" className="adm-btn adm-btn--dark">Approve</button>
      </form>
      <form action={decideComplianceChange} className="adm-inline">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="rejected" />
        <button type="submit" className="adm-btn">Reject</button>
      </form>
    </div>
  );
}

export default async function Compliance({ searchParams }: { searchParams: SP }) {
  const { api, token } = await requireOwner();
  const sp = await searchParams;
  const [rules, changes, sources, runs, siteRules] = await Promise.all([
    select<Rule[]>(api, "compliance_rules", { select: "*", order: "area.asc,code.asc" }, token),
    select<Change[]>(api, "compliance_changes", { select: "*", order: "created_at.desc", limit: "200" }, token),
    select<Source[]>(api, "compliance_sources", { select: "*", order: "authority.asc,name.asc" }, token),
    select<Run[]>(api, "compliance_runs", { select: "*", order: "started_at.desc", limit: "10" }, token),
    getSiteRules(),
  ]);

  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const pending = changes
    .filter((c) => c.status === "pending_review")
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.created_at.localeCompare(a.created_at));
  const decided = changes.filter((c) => c.status !== "pending_review").slice(0, 30);
  const active = rules.filter((r) => r.status === "active");
  const verified = active.filter((r) => r.last_verified_at).length;
  const open = active.filter((r) => r.certainty !== "confirmed").length;
  const areas = [...new Set(rules.map((r) => r.area))];
  const lastRun = runs[0];

  return (
    <>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">Compliance</h1>
      <p className="adm-muted">
        The UAE rules this shop follows for online sales: returns, information shown before purchase, VAT, e-invoicing, insurance,
        anti-money-laundering and personal data, each with its official source. Every Monday at 08:31 (Dubai) a monitor checks the
        official sources below, checks rules against the official text and proposes changes. Nothing changes until you approve it
        here or by replying to the weekly email. Not legal advice: ask your lawyer or accountant before approving changes to tax or
        return terms.
      </p>

      <div className="adm-stats">
        <div className="adm-stat">
          <span className="adm-stat__n">{pending.length}</span>
          <span className="adm-stat__l">Waiting for you</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__n">{active.length}</span>
          <span className="adm-stat__l">Active rules</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__n">{verified}</span>
          <span className="adm-stat__l">Checked against official text</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__n">{open}</span>
          <span className="adm-stat__l">Disputed, unverified or for a lawyer</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__n adm-stat__n--text">{lastRun ? day(lastRun.started_at) : "—"}</span>
          <span className="adm-stat__l">{lastRun ? `Last check: ${lastRun.status}` : "No check yet"}</span>
        </div>
      </div>

      <h2>Waiting for your decision</h2>
      {pending.length === 0 ? (
        <p className="adm-empty">Nothing is waiting. The monitor’s next report arrives on Monday.</p>
      ) : (
        <div className="adm-col adm-section">
          {pending.map((c) => {
            const r = c.rule_id ? ruleById.get(c.rule_id) : undefined;
            return (
              <section key={c.id} className="adm-card">
                <h3>
                  <span className="adm-ref">{c.ref}</span>
                  <span className={`adm-badge adm-badge--s-${c.severity}`}>{label(severityLabels, c.severity)}</span>
                  <span className="adm-badge">{label(changeTypeLabels, c.change_type)}</span>
                </h3>
                <p>{c.summary_en}</p>
                <p className="adm-quote adm-fa" dir="rtl" lang="fa">
                  {c.summary_fa}
                </p>
                <p className="adm-muted adm-small">
                  {r ? (
                    <>
                      Rule {r.code}: {r.title_en} ·{" "}
                    </>
                  ) : null}
                  found {when(c.created_at)} · <External href={c.evidence_url}>evidence</External>
                </p>
                {Object.keys(c.proposed ?? {}).length > 0 && (
                  <details>
                    <summary>What changes if you approve</summary>
                    <pre className="adm-pre">{JSON.stringify(c.proposed, null, 2)}</pre>
                  </details>
                )}
                <Decide id={c.id} />
              </section>
            );
          })}
        </div>
      )}

      <h2>On the website</h2>
      <p className="adm-muted adm-small">
        {siteRules.source === "ledger"
          ? "The website reads the approved rules below (changes show within a minute of approval)."
          : "The website can’t read the rules from the database yet (run the compliance database update), so it uses its built-in defaults."}{" "}
        Now: change-of-mind returns {siteRules.changeOfMindDays} days from delivery · faults on pieces without a warranty {siteRules.defectWindowDays} days
        {siteRules.defectWindowFrom === "purchase_date" ? " from purchase" : " from when the fault appears"} · returns and terms tick box at checkout{" "}
        {siteRules.requireTermsCheckbox ? "on" : "off"}.
      </p>
      <div className="adm-table-wrap adm-section">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Status</th>
              <th>Where</th>
            </tr>
          </thead>
          <tbody>
            {rules
              .filter((r) => r.status === "active")
              .map((r) => ({ r, c: siteCoverage[r.code] ?? { state: "off_site" as CoverageState, where: "Not part of the website." } }))
              .sort((a, b) => coverageOrder[a.c.state] - coverageOrder[b.c.state] || a.r.code.localeCompare(b.r.code))
              .map(({ r, c }) => (
                <tr key={r.id}>
                  <td>
                    <span className="adm-ref">{r.code}</span>
                    <span className="adm-code">{r.title_en}</span>
                  </td>
                  <td>
                    <span className={`adm-badge adm-badge--v-${c.state}`}>{coverageLabels[c.state]}</span>
                  </td>
                  <td className="adm-small">{c.where}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h2>Rules</h2>
      {rules.length === 0 && <p className="adm-empty">No rules yet.</p>}
      {areas.map((area) => (
        <section key={area} className="adm-section">
          <h3>{label(complianceAreaLabels, area)}</h3>
          {rules
            .filter((r) => r.area === area)
            .map((r) => (
              <details key={r.id} className="adm-card">
                <summary>
                  <span className="adm-ref">{r.code}</span> {r.title_en}
                  <span className={`adm-badge adm-badge--c-${r.certainty}`}>{label(certaintyLabels, r.certainty)}</span>
                  {r.status !== "active" && <span className="adm-badge adm-badge--k-retired">{r.status}</span>}
                  <span className="adm-muted adm-small"> · {r.applies_to.map((a) => label(appliesToLabels, a)).join(", ")}</span>
                </summary>
                <p className="adm-fa" dir="rtl" lang="fa">
                  <strong>{r.title_fa}</strong>
                </p>
                <p>{r.requirement_en}</p>
                <p className="adm-quote adm-fa" dir="rtl" lang="fa">
                  {r.requirement_fa}
                </p>
                <h4 className="adm-small">What the website must do</h4>
                <p>{r.site_action}</p>
                <Params params={r.site_params} />
                <p className="adm-muted adm-small">
                  {r.law_reference} · <External href={r.source_url}>source</External>
                  {r.effective_from && ` · in force from ${day(r.effective_from)}`} ·{" "}
                  {r.last_verified_at ? `checked against official text ${day(r.last_verified_at)}` : "not yet checked against the official text"}
                </p>
                {r.notes && <p className="adm-small">Note: {r.notes}</p>}
              </details>
            ))}
        </section>
      ))}

      <h2>Official sources checked every week</h2>
      <div className="adm-table-wrap adm-section">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Watching for</th>
              <th>Last checked</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <External href={s.url}>{s.name}</External>
                  <span className="adm-code">{s.authority}</span>
                </td>
                <td className="adm-small">{s.watch_for}</td>
                <td>{when(s.last_checked_at)}</td>
                <td>
                  {s.last_result ? label(resultLabels, s.last_result) : "—"}
                  {s.last_snapshot && <span className="adm-code">{s.last_snapshot}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Weekly checks</h2>
      {runs.length === 0 ? (
        <p className="adm-empty">No check has run yet. The monitor runs every Monday at 08:31 Dubai time.</p>
      ) : (
        <div className="adm-table-wrap adm-section">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Status</th>
                <th>Sources</th>
                <th>Changes</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{when(run.started_at)}</td>
                  <td>{run.status}</td>
                  <td>{run.sources_checked}</td>
                  <td>{run.changes_found}</td>
                  <td>
                    {run.error && <span className="adm-code">{run.error}</span>}
                    {run.report && (
                      <details>
                        <summary>Read</summary>
                        <p className="adm-pre adm-fa" dir="auto">
                          {run.report}
                        </p>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {decided.length > 0 && (
        <>
          <h2>Decided</h2>
          <div className="adm-table-wrap adm-section">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Change</th>
                  <th>Decision</th>
                  <th>Summary</th>
                  <th>Decided</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((c) => (
                  <tr key={c.id}>
                    <td className="adm-ref">{c.ref}</td>
                    <td>{label(changeStatusLabels, c.status)}</td>
                    <td className="adm-small">
                      {c.summary_en}
                      {c.review_note && <span className="adm-code">Note: {c.review_note}</span>}
                    </td>
                    <td>{when(c.reviewed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
