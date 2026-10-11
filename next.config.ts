import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Product photos live in the public "product-images" Supabase Storage bucket. They are fetched and
// resized by next/image and served from this origin, so the CSP below still needs only 'self'.
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const productImagePatterns = supabaseUrl
  ? [new URL("/storage/v1/object/public/product-images/**", supabaseUrl)]
  : [];

// Customer photos (private panel) use short-lived signed Storage links; 360° media is public.
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";

// Everything is served from this origin; WhatsApp, email and Instagram are plain outbound links.
const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the 3D viewer compile its WebAssembly helpers; it does not allow eval().
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "font-src 'self'",
  // 3D models of real pieces are fetched straight from the product-media Storage bucket.
  // and read their embedded textures through blob: URLs.
  `connect-src 'self' blob: data:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75, 85],
    remotePatterns: productImagePatterns,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
