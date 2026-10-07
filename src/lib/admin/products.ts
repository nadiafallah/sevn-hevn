import "server-only";
import { publicImageUrl } from "@/lib/supabase";

/** A piece as the panel reads it (drafts included; row-level security limits this to the team). */
export interface PanelProduct {
  ref: string;
  published: boolean;
  status: "editorial_preview" | "enquiry_only" | "available" | "reserved" | "sold";
  name: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  model_reference: string | null;
  description: string | null;
  price_aed: number | null;
  stock: number | null;
  condition: string | null;
  condition_notes: string | null;
  year: string | null;
  material: string | null;
  colour: string | null;
  size: string | null;
  dimensions: string | null;
  included: string[];
  authentication: string | null;
  delivery: string | null;
  returns: string | null;
  featured: boolean;
  updated_at: string;
  product_images: { id: number; storage_path: string; width: number; height: number; alt: string; position: number }[];
}

export const PRODUCT_SELECT =
  "ref,published,status,name,category,subcategory,brand,model_reference,description,price_aed,stock,condition,condition_notes," +
  "year,material,colour,size,dimensions,included,authentication,delivery,returns,featured,updated_at," +
  "product_images(id,storage_path,width,height,alt,position)";

export const PRODUCT_PHOTO_LIMIT = 12;

export const productStatusOptions = [
  { id: "enquiry_only", label: "Enquire only", hint: "Shown with its price, if you add one, and an “Enquire” button. Best until online payment is set up." },
  { id: "available", label: "Available to buy", hint: "Can be added to the bag. Needs a price, stock (at least 1) and delivery details." },
  { id: "reserved", label: "Reserved", hint: "Stays visible but can’t be bought." },
  { id: "sold", label: "Sold", hint: "Stays visible as sold. To remove it from the website, hide it instead." },
] as const;

export const productStatusLabel = (s: string) => productStatusOptions.find((o) => o.id === s)?.label ?? s;

export function productImageUrl(storagePath: string) {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  return url ? publicImageUrl(url, storagePath) : null;
}

/** Characters that would break a PostgREST filter are dropped from free-text search. */
export const searchTerm = (q: string) => q.replace(/[^\p{L}\p{N} &'.-]/gu, "").trim().slice(0, 60);
