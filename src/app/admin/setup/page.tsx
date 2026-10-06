import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { setupAccount } from "../actions";

export const metadata = { title: "Set up access" };

export default async function Setup({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <main className="adm-auth">
      <div className="adm-auth__card">
        <Wordmark className="adm-auth__logo" />
        <h1 className="adm-auth__title">Set up your access</h1>
        <p className="adm-muted adm-small">
          Only for people the owner has added to the team. Choose a password (at least 12 characters). We’ll email you a confirmation link; after opening it, sign in.
        </p>
        <Flash ok={one(sp.ok)} error={one(sp.error)} />
        <form action={setupAccount} className="adm-form">
          <label>
            Your work email
            <input name="email" type="email" autoComplete="username" required maxLength={254} />
          </label>
          <label>
            New password
            <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={200} />
          </label>
          <label>
            Repeat the password
            <input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={200} />
          </label>
          <button type="submit" className="adm-btn adm-btn--dark">
            Continue
          </button>
        </form>
        <p className="adm-muted adm-small">
          <Link href="/admin/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
