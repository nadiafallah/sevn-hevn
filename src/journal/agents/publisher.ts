import { QUALITY_THRESHOLD } from "../config";
import type { PublishDecision } from "../contracts/publish";
import { draftProblems, type DraftChecks, type ScoredReview } from "../contracts/review";

/**
 * Publisher: no model, one rule. Published only when every condition holds; otherwise the article
 * stays a draft for a person to decide, with the reasons listed.
 */
export function publisher(a: { review: ScoredReview | null; checks: DraftChecks | null; seoErrors: string[] | null; autoPublish: boolean }): PublishDecision {
  const reasons: string[] = [];
  if (!a.review) reasons.push("The article has no editor review.");
  else {
    if (a.review.score < QUALITY_THRESHOLD) reasons.push(`The editor's score is ${a.review.score}, below ${QUALITY_THRESHOLD}.`);
    if (a.review.verdict !== "approve") reasons.push("The editor's verdict is rewrite.");
    const blockers = a.review.issues.filter((i) => i.severity === "blocker").length;
    if (blockers) reasons.push(`${blockers} blocker issue${blockers > 1 ? "s" : ""} remain.`);
  }
  if (!a.checks) reasons.push("The article was not checked.");
  else reasons.push(...draftProblems(a.checks));
  if (a.seoErrors === null) reasons.push("There is no SEO metadata.");
  else reasons.push(...a.seoErrors.map((e) => `SEO: ${e}`));
  if (!a.autoPublish) reasons.push("Automatic publishing is switched off (JOURNAL_AUTO_PUBLISH).");
  return { decision: reasons.length ? "draft" : "published", reasons };
}
