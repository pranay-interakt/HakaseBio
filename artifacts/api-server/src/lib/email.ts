/**
 * Email sender — Resend.
 * Required for verify-email and password-reset flows.
 * Fails loud if the call to Resend fails. No silent swallow.
 */
import { loadEnv } from "./env.js";

const RESEND_URL = "https://api.resend.com/emails";

interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(opts: SendOpts): Promise<void> {
  const env = loadEnv();
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[email] Resend error", res.status, body);
    if (env.NODE_ENV === "development") {
      console.warn(`\n[email] [DEVELOPMENT MODE] Failed to send email to ${opts.to} due to Resend error ${res.status}.`);
      console.warn(`[email] [DEVELOPMENT MODE] Bypassing email error and printing the link below:`);
      const linkMatch = opts.html.match(/href="([^"]+)"/);
      if (linkMatch && linkMatch[1]) {
        console.warn(`\n>>> DEVELOPMENT LINK: ${linkMatch[1]} <<<\n`);
      }
      return;
    }
    throw new Error(`Failed to send email (Resend ${res.status}): ${body.slice(0, 200)}`);
  }
}

export function verifyEmailHtml(verifyUrl: string): string {
  return `
<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#07080c;color:#fff;padding:32px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin:0 auto;background:#0d0f17;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px">
  <tr><td>
    <h2 style="margin:0 0 12px;font-size:20px">Verify your email</h2>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6">Welcome to HakaseAI. Click the button below to verify your email address. This link expires in 24 hours.</p>
    <p style="margin:24px 0"><a href="${verifyUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:14px">Verify email</a></p>
    <p style="color:#64748b;font-size:12px;word-break:break-all">If the button doesn't work, paste this URL into your browser:<br>${verifyUrl}</p>
  </td></tr>
</table></body></html>`;
}

export function passwordResetHtml(resetUrl: string): string {
  return `
<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#07080c;color:#fff;padding:32px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin:0 auto;background:#0d0f17;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px">
  <tr><td>
    <h2 style="margin:0 0 12px;font-size:20px">Reset your password</h2>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6">We received a request to reset your HakaseAI password. This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>
    <p style="margin:24px 0"><a href="${resetUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:14px">Reset password</a></p>
    <p style="color:#64748b;font-size:12px;word-break:break-all">If the button doesn't work, paste this URL into your browser:<br>${resetUrl}</p>
  </td></tr>
</table></body></html>`;
}

export function securityNoticeHtml(message: string): string {
  return `
<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#07080c;color:#fff;padding:32px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin:0 auto;background:#0d0f17;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px">
  <tr><td>
    <h2 style="margin:0 0 12px;font-size:20px">Security notice</h2>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6">${message}</p>
    <p style="color:#64748b;font-size:12px">If this wasn't you, reset your password immediately and contact support.</p>
  </td></tr>
</table></body></html>`;
}
