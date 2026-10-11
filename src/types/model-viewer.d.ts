import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";

/** <model-viewer> custom element (https://modelviewer.dev). Attributes are passed as strings. */
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        ref?: Ref<HTMLElement>;
        class?: string;
        [attribute: `${string}-${string}`]: string | undefined;
        src?: string;
        poster?: string;
        alt?: string;
        loading?: string;
        reveal?: string;
        exposure?: string;
      };
    }
  }
}
