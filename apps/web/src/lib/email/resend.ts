/**
 * Email sending via Resend API.
 * Uses raw fetch — no new npm dependency needed.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'Even OS <noreply@even.in>';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[EMAIL] RESEND_API_KEY not set — logging email instead of sending');
    console.log(`[EMAIL] To: ${options.to} | Subject: ${options.subject}`);
    console.log(`[EMAIL] Body: ${options.text || options.html}`);
    return { success: true }; // Don't block the flow
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[EMAIL] Resend error:', res.status, err);
      return { success: false, error: `Email service error: ${res.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error('[EMAIL] Failed to send:', error);
    return { success: false, error: 'Failed to connect to email service' };
  }
}

export function otpEmailHtml(code: string, userName: string): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1e3a5f; margin-bottom: 8px;">Even OS — Device Verification</h2>
      <p style="color: #666; font-size: 14px;">Hi ${userName},</p>
      <p style="color: #666; font-size: 14px;">
        A login was attempted from a new device. Enter this code to verify:
      </p>
      <div style="background: #f0f4f8; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
        <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1e3a5f;">${code}</span>
      </div>
      <p style="color: #999; font-size: 12px;">This code expires in 10 minutes. If you didn't try to log in, change your password immediately.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #bbb; font-size: 11px;">Even Healthcare © ${new Date().getFullYear()}</p>
    </div>
  `;
}

export function passwordResetEmailHtml(resetUrl: string, userName: string): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1e3a5f; margin-bottom: 8px;">Even OS — Password Reset</h2>
      <p style="color: #666; font-size: 14px;">Hi ${userName},</p>
      <p style="color: #666; font-size: 14px;">
        We received a request to reset your password. Click the button below to set a new one:
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" style="background: #1e3a5f; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Reset Password
        </a>
      </div>
      <p style="color: #999; font-size: 12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      <p style="color: #ccc; font-size: 11px; word-break: break-all;">Direct link: ${resetUrl}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #bbb; font-size: 11px;">Even Healthcare © ${new Date().getFullYear()}</p>
    </div>
  `;
}

export function breakGlassNotificationHtml(userName: string, userEmail: string, reason: string, expiresAt: string): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #dc2626; margin-bottom: 8px;">⚠️ Break-Glass Access Activated</h2>
      <p style="color: #666; font-size: 14px;">
        <strong>${userName}</strong> (${userEmail}) has activated emergency break-glass access.
      </p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="color: #991b1b; font-size: 13px; margin: 0;"><strong>Reason:</strong> ${reason}</p>
        <p style="color: #991b1b; font-size: 13px; margin: 8px 0 0;"><strong>Expires:</strong> ${expiresAt}</p>
      </div>
      <p style="color: #999; font-size: 12px;">Review this access in the admin panel at /admin/break-glass-log.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #bbb; font-size: 11px;">Even Healthcare © ${new Date().getFullYear()}</p>
    </div>
  `;
}
