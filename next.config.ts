import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Product photos live in the public "product-images" Supabase Storage bucket. They are fetched and
// resized by next/image and served from this origin, so the CSP below still needs only 'self'.
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const productImagePatterns = supabaseUrl
  ? [new URL("/storage/v1/object/public/product-images/**", supabaseUrl)]
  : [];

// The local test stack (scripts/local-stack.mjs) serves photos from 127.0.0.1. Only then may the
// image optimiser fetch from a local address; on Vercel SUPABASE_URL is the public https project.
const localStack = !!supabaseUrl && ["127.0.0.1", "localhost"].includes(new URL(supabaseUrl).hostname);

// Private panel only: customer photos are shown through short-lived signed Storage links.
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";

// Everything is served from this origin; WhatsApp, email and Instagram are plain outbound links. The
// one exception: a journal article's video plays in YouTube's privacy-enhanced player once clicked.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  // Journal articles may play a house's own film in YouTube's privacy-enhanced player, after a click.
  "frame-src https://www.youtube-nocookie.com",
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
    // Product photos, and the stills of the houses' films shown in journal articles before play.
    remotePatterns: [...productImagePatterns, { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" }],
    dangerouslyAllowLocalIP: localStack,
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
