// The website's reading of the approved compliance rules (no database, no network):
// run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSiteRules, returnsLine, returnsNotice, siteCoverage, siteRulesFrom } from "../src/lib/compliance-rules";
import { en } from "../src/i18n/dictionaries/en";

const w = en.ui.returnsTerms;

test("rules: the database's values are read; anything missing or malformed keeps its default", () => {
  const r = siteRulesFrom({
    "RET-CHANGE-OF-MIND": { params: { change_of_mind_days: 14 } },
    "RET-NO-WARRANTY-30": { params: { defect_window_days: 30, window_starts: "purchase_date" } },
    "DIS-PRE-ORDER": { params: { require_terms_checkbox: false } },
    "PRC-DISCOUNT-7D": { params: { discount_lookback_days: "nope", refund_within_days: 45 } },
  });
  assert.equal(r.source, "ledger");
  assert.equal(r.changeOfMindDays, 14);
  assert.equal(r.defectWindowFrom, "purchase_date");
  assert.equal(r.requireTermsCheckbox, false);
  assert.equal(r.discountLookbackDays, defaultSiteRules.discountLookbackDays);
  assert.equal(r.discountRefundDays, 45);

  for (const raw of [null, [], "x", 3]) assert.equal(siteRulesFrom(raw).source, "defaults");
  const odd = siteRulesFrom({ "RET-CHANGE-OF-MIND": { params: { change_of_mind_days: -1 } }, "RET-NO-WARRANTY-30": { params: { defect_window_days: 0 } } });
  assert.equal(odd.changeOfMindDays, 7);
  assert.equal(odd.defectWindowDays, 30);
});

test("returns notice: every paragraph is filled in, with the rule's numbers", () => {
  const text = returnsNotice({ ...defaultSiteRules, changeOfMindDays: 10, defectWindowDays: 30 }, w);
  assert.equal(text.length, 6);
  assert.ok(text.every((p) => !/\{\w+\}/.test(p)), "no unfilled placeholders");
  assert.match(text.join(" "), /within 10 days of delivery/);
  assert.match(text.join(" "), /within 30 days of the fault appearing/);
  assert.match(text.join(" "), /within 7 days of your purchase/);
  assert.doesNotMatch(text.join(" ").toLowerCase(), /final sale|no returns/);

  const none = returnsNotice({ ...defaultSiteRules, changeOfMindDays: 0 }, w);
  assert.ok(none.includes(w.noChangeOfMind));
  assert.equal(returnsLine({ ...defaultSiteRules, changeOfMindDays: 0 }, w), w.productLineNoChangeOfMind);
  assert.match(returnsLine(defaultSiteRules, w), /within 7 days of delivery/);
});

test("coverage: every website-facing rule says where it is applied", () => {
  for (const [code, c] of Object.entries(siteCoverage)) {
    assert.match(code, /^[A-Z]+(-[A-Z0-9]+)+$/);
    assert.ok(["live", "partial", "not_yet", "off_site"].includes(c.state));
    assert.ok(c.where.length > 10);
  }
});
