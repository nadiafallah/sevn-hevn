import "server-only";
import { cache } from "react";
import { defaultSiteRules, siteRulesFrom, type SiteRules } from "@/lib/compliance-rules";
import { supabaseReadConfig } from "@/lib/supabase";

/**
 * The approved compliance rules the website follows, read from Supabase
 * (public.compliance_site_settings: rule code → site_params only). Cached for ten minutes under this
 * tag; approving a change in the panel expires it at once. If the database can't be read (offline
 * development, before the migration, an outage) the site uses the defaults in compliance-rules.ts,
 * which match the rules approved on 27 Oct 2026.
 */
export const COMPLIANCE_TAG = "compliance";
const REFRESH_SECONDS = 600;

export const getSiteRules = cache(async (): Promise<SiteRules> => {
  const cfg = supabaseReadConfig();
  if (!cfg) return defaultSiteRules;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/compliance_site_settings`, {
      headers: { apikey: cfg.key, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: REFRESH_SECONDS, tags: [COMPLIANCE_TAG] },
    });
    if (!res.ok) return defaultSiteRules;
    return siteRulesFrom(await res.json());
  } catch {
    return defaultSiteRules;
  }
});
