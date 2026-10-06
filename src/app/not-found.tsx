import Link from "next/link";
import { SiteChrome } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <SiteChrome>
      <section className="container nf">
        <p className="eyebrow">Page not found</p>
        <h1 className="display display--sm">This page isn’t here.</h1>
        <p>The link may be out of date. The collection and our team are a click away.</p>
        <div className="stack-actions">
          <Link href="/collection" className="btn btn--dark">
            Explore the Collection
          </Link>
          <Link href="/" className="btn btn--line">
            Home
          </Link>
        </div>
      </section>
    </SiteChrome>
  );
}
