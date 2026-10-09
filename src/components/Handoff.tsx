"use client";

import { useState } from "react";
import { emailUrl, whatsappUrl } from "@/lib/whatsapp";
import { track } from "@/lib/analytics";
import { site } from "@/config/site";
import { useI18n } from "@/i18n/I18nProvider";
import { interpolate } from "@/i18n/rich";
import { WhatsAppIcon } from "./icons";
import { WebsiteSend, methodKey, type SentEnquiry, type WebsiteSendRequest } from "./WebsiteSend";

/**
 * Shown after a form validates. Nothing has been sent at this point: the customer
 * opens WhatsApp (or email) with the prepared message and sends it themselves — which the
 * website cannot see, so it records nothing. Only the optional "send from the website" path
 * stores the request, and "received" is shown only once the server confirms it.
 */
export function Handoff({
  message,
  emailSubject,
  onEdit,
  source,
  send,
  tone,
}: {
  message: string;
  emailSubject: string;
  onEdit: () => void;
  source: string;
  send?: WebsiteSendRequest;
  tone?: "light" | "dark";
}) {
  const { t } = useI18n();
  const h = t.handoff;
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [sent, setSent] = useState<SentEnquiry | null>(null);
  const phone = (
    <a href={site.contact.telHref} dir="ltr">
      {site.contact.phoneDisplay}
    </a>
  );

  if (sent) {
    return (
      <div className="handoff" role="status" aria-live="polite">
        <p className="eyebrow">{h.receivedEyebrow}</p>
        <p className="handoff__lead">
          {interpolate(h.received, {
            ref: (
              <strong>
                <bdi dir="ltr">{sent.reference}</bdi>
              </strong>
            ),
            method: h.methodsInline[methodKey[sent.method]],
            contact: <bdi dir="ltr">{sent.contactValue}</bdi>,
          })}
        </p>
        <p className="handoff__note">{interpolate(h.quoteRef, { phone })}</p>
      </div>
    );
  }

  return (
    <div className="handoff" role="status" aria-live="polite">
      <p className="eyebrow">{h.readyEyebrow}</p>
      <p className="handoff__lead">{interpolate(h.readyLead, { send: <strong>{h.send}</strong> })}</p>
      <pre className="handoff__preview" tabIndex={0} aria-label={h.preparedMessage} dir="auto">
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
          <WhatsAppIcon size={18} /> {h.openWhatsApp}
        </a>
        <a className="btn btn--line" href={emailUrl(emailSubject, message)} onClick={() => track("email_click", { source })}>
          {h.emailInstead}
        </a>
      </div>
      {opened && (
        <p className="handoff__note">
          {interpolate(h.opened, {
            email: (
              <a href={site.contact.emailHref} dir="ltr">
                {site.contact.email}
              </a>
            ),
            phone,
          })}
        </p>
      )}
      {send && <WebsiteSend send={send} tone={tone} onSent={setSent} />}
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
          {copied === "done" ? h.copied : copied === "failed" ? h.copyFailed : h.copy}
        </button>
        <button type="button" className="link-btn" onClick={onEdit}>
          {h.edit}
        </button>
      </div>
    </div>
  );
}
