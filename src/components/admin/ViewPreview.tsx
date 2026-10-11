"use client";

import type { Item } from "@/data/types";
import { en } from "@/i18n/dictionaries/en";
import { I18nProvider } from "@/i18n/I18nProvider";
import { LazyProductViewer } from "@/components/viewer/View360Button";

/** The website's own viewer, so the owner sees exactly what customers will see — before switching it on. */
export function ViewPreview({ item }: { item: Pick<Item, "ref" | "name" | "brand" | "view" | "interior"> }) {
  return (
    <I18nProvider locale="en" ui={en.ui}>
      <div className="adm-view-preview">
        <LazyProductViewer item={item} />
      </div>
    </I18nProvider>
  );
}
