import { notFound } from "next/navigation";

/** Any other address shows the 404 page inside the site frame. */
export default function CatchAll() {
  notFound();
}
