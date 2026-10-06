import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: { default: "Private panel", template: "%s · SEVN HEVN panel" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return <div className="adm">{children}</div>;
}
