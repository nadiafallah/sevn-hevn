/** Shapes shared by the concierge server and the chat interface. */
import type { Locale } from "./i18n";

export interface Choice {
  id: string;
  label: string;
  /** Opens a link instead of answering ("#whatsapp" is resolved by the browser). */
  href?: string;
}

export interface Prompt {
  kind: "choices" | "text" | "phone" | "email" | "code" | "review";
  choices: Choice[];
  allowPhoto: boolean;
  multiline: boolean;
  maxLength: number;
  review?: { title: string; rows: { label: string; value: string }[]; consent: string; submit: string; edit: string };
}

export interface ClientMessage {
  role: "customer" | "assistant";
  body: string;
}

export interface ClientReply {
  conversation: { id: string; token?: string };
  locale: Locale;
  messages: ClientMessage[];
  prompt: Prompt;
  submitted?: { reference: string };
}
