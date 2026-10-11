import { notFound } from "next/navigation";

/** Any other address under a language shows that language's 404 page inside the site frame. */
export default function CatchAll() {
  notFound();
}
