import { t } from "./i18n";
import type { Prompt } from "./types";

/** The opening menu. Used by the server engine and shown instantly by the chat before any request. */
export function menuPrompt(): Prompt {
  const L = t();
  return {
    kind: "choices",
    choices: [
      { id: "sourcing", label: L.menu.sourcing },
      { id: "question", label: L.menu.question },
      { id: "order", label: L.menu.order },
      { id: "callback", label: L.menu.callback },
    ],
    allowPhoto: true,
    multiline: false,
    maxLength: 1000,
  };
}

export function introMessages() {
  const L = t();
  return [L.a.greeting, L.a.menu];
}
