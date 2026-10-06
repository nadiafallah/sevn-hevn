import { Wordmark } from "@/components/Wordmark";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { ResetForm } from "@/components/admin/ResetForm";

export const metadata = { title: "Choose a new password" };

export default async function Reset({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <main className="adm-auth">
      <div className="adm-auth__card">
        <Wordmark className="adm-auth__logo" />
        <h1 className="adm-auth__title">Choose a new password</h1>
        <Flash error={one(sp.error)} />
        <ResetForm />
      </div>
    </main>
  );
}
