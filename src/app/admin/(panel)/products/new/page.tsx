import Link from "next/link";
import { requireOwner } from "@/lib/admin/session";
import { Flash, one, type SP } from "@/components/admin/Flash";
import { ProductFields } from "@/components/admin/ProductFields";
import { createProduct } from "../../../actions";

export const metadata = { title: "Add a piece" };

export default async function NewProduct({ searchParams }: { searchParams: SP }) {
  await requireOwner();
  const sp = await searchParams;
  return (
    <>
      <p className="adm-crumbs">
        <Link href="/admin/products">← Products</Link>
      </p>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      <h1 className="adm-h1">Add a piece</h1>
      <p className="adm-muted">
        The piece is saved as a <strong>draft</strong> that only the team can see. On the next page you add photos and publish it. Only name and category are required.
      </p>
      <form action={createProduct} className="adm-form adm-card">
        <ProductFields />
        <button type="submit" className="adm-btn adm-btn--dark">
          Save draft and add photos
        </button>
      </form>
    </>
  );
}
