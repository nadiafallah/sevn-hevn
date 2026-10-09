import type { Metadata, Viewport } from "next";
import { site } from "@/config/site";
import { fontVariables } from "../fonts";
import "../globals.css";
import "./admin.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: "Private panel", template: "%s · SEVN HEVN panel" },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { themeColor: "#F5F0E8", width: "device-width", initialScale: 1 };

/** The private panel has its own root layout (in English, for the team); the public site's is under [locale]. */
export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <div className="adm">{children}</div>
      </body>
    </html>
  );
}
