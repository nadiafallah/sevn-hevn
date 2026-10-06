"use client";

import { useEffect, useState } from "react";
import { completeReset } from "@/app/admin/actions";

/**
 * The reset e-mail link returns here with a one-time recovery session in the URL fragment
 * (never sent to any server by the browser). It is read once, removed from the address bar and
 * posted only with the new password.
 */
export function ResetForm() {
  const [tokens, setTokens] = useState<{ access: string; refresh: string } | null | undefined>(undefined);

  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const access = p.get("access_token");
    const refresh = p.get("refresh_token") ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTokens(access && p.get("type") === "recovery" ? { access, refresh } : null);
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  if (tokens === undefined) return null;
  if (!tokens) return <p className="adm-muted">This page opens from the password-reset email. Request a new link from the sign-in page.</p>;
  return (
    <form action={completeReset} className="adm-form">
      <input type="hidden" name="access_token" value={tokens.access} />
      <input type="hidden" name="refresh_token" value={tokens.refresh} />
      <label>
        New password
        <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} />
      </label>
      <label>
        Repeat the password
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} />
      </label>
      <button type="submit" className="adm-btn adm-btn--dark">
        Save the new password
      </button>
    </form>
  );
}
