"use client";

import { useState } from "react";
import { emailUrl, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { site } from "@/config/site";
import { WhatsAppIcon } from "./icons";

/**
 * Shown after a form validates. Nothing has been sent at this point: the customer
 * opens WhatsApp (or email) with the prepared message and sends it themselves.
 */
export function Handoff({
  message,
  emailSubject,
  onEdit,
  source,
}: {
  message: string;
  emailSubject: string;
  onEdit: () => void;
  source: string;
}) {
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  return (
    <div className="handoff" role="status" aria-live="polite">
      <p className="eyebrow">Your message is ready</p>
      <p className="handoff__lead">
        Nothing has been sent yet. Open WhatsApp with your prepared message, then press <strong>Send</strong> there to reach our team.
      </p>
      <pre className="handoff__preview" tabIndex={0} aria-label="Prepared message">
        {message}
      </pre>
      <div className="handoff__actions">
        <a
          className="btn btn--dark"
          href={whatsappUrl(message)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            setOpened(true);
            track("whatsapp_click", { source });
          }}
        >
          <WhatsAppIcon size={18} /> Open WhatsApp to send
        </a>
        <a className="btn btn--line" href={emailUrl(emailSubject, message)} onClick={() => track("email_click", { source })}>
          Email instead
        </a>
      </div>
      {opened && (
        <p className="handoff__note">
          WhatsApp should have opened in a new tab or app. If it didn’t, email us at{" "}
          <a href={site.contact.emailHref}>{site.contact.email}</a> or call{" "}
          <a href={site.contact.telHref}>{site.contact.phoneDisplay}</a>.
        </p>
      )}
      <div className="handoff__secondary">
        <button
          type="button"
          className="link-btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message);
              setCopied("done");
            } catch {
              setCopied("failed");
            }
          }}
        >
          {copied === "done" ? "Copied" : copied === "failed" ? "Copy unavailable — select the text above" : "Copy message"}
        </button>
        <button type="button" className="link-btn" onClick={onEdit}>
          Edit request
        </button>
      </div>
    </div>
  );
}
