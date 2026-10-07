import { errorMessages } from "@/lib/admin/labels";

const okMessages: Record<string, string> = {
  saved: "Saved.",
  note_added: "Note added.",
  call_logged: "Call result recorded.",
  price_recorded: "Price / availability recorded.",
  notification_retried: "Notification sent again (see its status below).",
  deleted: "The request was deleted.",
  product_created: "Piece created as a draft. Add photos, then publish it.",
  product_saved: "Saved. The website updates within a minute.",
  product_published: "Published. The piece is now on the website.",
  product_unpublished: "Hidden from the website. It stays here as a draft.",
  product_deleted: "The piece and its photos were deleted.",
  photo_main: "Main photo changed.",
  photo_removed: "Photo removed.",
  order_created: "Order created.",
  saved_draft: "Saved as a draft. Approve it to let the chat quote it.",
  approved: "Approved. The chat may now quote this entry.",
  retired: "Retired. The chat no longer quotes this entry.",
  draft: "Moved back to draft.",
  added: "Added. They can now set up their access at /admin/setup.",
  test_email_sent: "Test email sent. Check the inbox.",
  password_changed: "Password changed.",
  signed_out: "You are signed out.",
  confirmed: "Email confirmed. You can sign in now.",
  reset_sent: "If that address has an account, a reset link has been sent.",
  check_email: "If this address is on the team list, a confirmation email is on its way. Open the link in it, then sign in here with your new password.",
};

const extraErrors: Record<string, string> = {
  credentials: "The email or password is not correct.",
  unconfirmed: "Please confirm your email address first (use the link in the confirmation email).",
  no_access: "This account doesn’t have access to the panel. Ask the owner to add you.",
  email: "Please enter a valid email address.",
  password_short: "Use at least 12 characters.",
  password_mismatch: "The two passwords don’t match.",
  password_weak: "That password is too weak. Please choose a longer, less common one.",
  link_expired: "The reset link has expired. Please request a new one.",
  confirm_delete: "Type DELETE to confirm.",
  test_email_failed: "The test email could not be sent. Check the email settings.",
};

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) {
    return (
      <p className="adm-flash adm-flash--error" role="alert">
        {extraErrors[error] ?? errorMessages[error] ?? errorMessages.db_error}
      </p>
    );
  }
  if (ok && okMessages[ok]) {
    return (
      <p className="adm-flash" role="status">
        {okMessages[ok]}
      </p>
    );
  }
  return null;
}

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
