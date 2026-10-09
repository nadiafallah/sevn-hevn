/**
 * Interim customer information. These are NOT final business policies; they describe only what is
 * true today. The wording, in every language, lives in the dictionaries (`ui.policies`) under
 * src/i18n/dictionaries/. Replace it with the approved final policy text once the business confirms
 * it, and set the policy to final here.
 */
export type PolicyId = "shipping" | "returns" | "privacy" | "terms";

export const policyIds: PolicyId[] = ["shipping", "returns", "privacy", "terms"];

/** Final (approved) policies show no "interim notice" tag. */
export const policyFinal: Record<PolicyId, boolean> = { shipping: false, returns: false, privacy: false, terms: false };

export function isPolicyId(id: string): id is PolicyId {
  return (policyIds as string[]).includes(id);
}
