import { Fragment, type ReactNode } from "react";

/** Renders "*text*" as <em>text</em> (the italic accent used in headings). */
export function rich(text: string): ReactNode {
  const parts = text.split("*");
  return parts.map((part, i) => (i % 2 === 1 ? <em key={i}>{part}</em> : <Fragment key={i}>{part}</Fragment>));
}

/**
 * Fills "{name}" placeholders with React nodes, e.g. a <strong> reference or a phone link, so the
 * word order of each language is kept.
 */
export function interpolate(template: string, nodes: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = part.match(/^\{(\w+)\}$/);
    return <Fragment key={i}>{m && m[1] in nodes ? nodes[m[1]] : part}</Fragment>;
  });
}

/** Keeps phone numbers, references, e-mail addresses and prices left-to-right inside Arabic text. */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
