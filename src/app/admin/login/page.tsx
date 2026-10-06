import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { currentStaff } from "@/lib/admin/session";
import { authAvailable } from "@/lib/admin/gotrue";
import { forgotPassword, login } from "../actions";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: SP }) {
  if (await currentStaff()) redirect("/admin");
  const sp = await searchParams;
  return (
    <main className="adm-auth">
      <div className="adm-auth__card">
        <Wordmark className="adm-auth__logo" />
        <h1 className="adm-auth__title">Private panel</h1>
        <Flash ok={one(sp.ok)} error={one(sp.error)} />
        {!authAvailable() ? (
          <p className="adm-muted">Sign-in is not configured in this environment.</p>
        ) : (
          <>
            <form action={login} className="adm-form">
              <input type="hidden" name="next" value={one(sp.next) ?? ""} />
              <label>
                Email
                <input name="email" type="email" autoComplete="username" required maxLength={254} />
              </label>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" required maxLength={200} />
              </label>
              <button type="submit" className="adm-btn adm-btn--dark">
                Sign in
              </button>
            </form>
            <details className="adm-auth__more">
              <summary>Forgot your password?</summary>
              <form action={forgotPassword} className="adm-form">
                <label>
                  Email
                  <input name="email" type="email" autoComplete="username" required maxLength={254} />
                </label>
                <button type="submit" className="adm-btn">
                  Send a reset link
                </button>
              </form>
            </details>
            <p className="adm-muted adm-small">
              First time here? The owner adds you to the team, then you <Link href="/admin/setup">set up your access</Link>.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
