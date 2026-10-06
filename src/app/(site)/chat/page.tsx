import type { Metadata } from "next";
import { ChatPage } from "@/components/concierge/ChatPage";

export const metadata: Metadata = {
  title: "Concierge chat",
  description: "Ask the SEVN HEVN concierge to find a piece, answer a question or arrange a call from our team in Dubai. In English and Arabic.",
  alternates: { canonical: "/chat" },
};

export default function Chat() {
  return (
    <section className="container chat-page">
      <header className="chat-page__intro">
        <p className="eyebrow">Private client services</p>
        <h1 className="display display--sm">Concierge</h1>
        <p className="chat-page__lede">
          Tell our virtual assistant what you are looking for, in English or Arabic. Your request goes to our team in Dubai, who follow up personally.
        </p>
      </header>
      <ChatPage />
    </section>
  );
}
