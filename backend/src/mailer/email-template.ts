// Shared branded shell for transactional emails (verification, password
// reset). Table-based layout + fully inline styles are not a stylistic
// choice: Gmail/Outlook strip <style> blocks in <head>, and Outlook desktop
// renders HTML through Word's engine, which only handles table layouts
// reliably. No logo image either — SVG barely renders in email clients and
// images are blocked by default in most inboxes until the reader opts in;
// a colored text wordmark survives both.
export function renderEmail({
  preheader,
  greeting,
  bodyHtml,
  cta,
}: {
  preheader: string;
  greeting: string;
  bodyHtml: string;
  // Omitted for purely informational notices (GDPR export/deletion
  // confirmations) that have no action link to send the reader to.
  cta?: { label: string; url: string; footerNote: string };
}): string {
  const ctaBlock = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background:#e0a355;">
                      <a href="${cta.url}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:700;color:#18140e;text-decoration:none;">${cta.label}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#8a8072;word-break:break-all;">${cta.footerNote}<br>${cta.url}</p>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;">
    <span style="display:none;font-size:1px;color:#f4f1ea;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e0d4;">
            <tr>
              <td style="padding:28px 32px 0;">
                <span style="font-size:20px;font-weight:700;color:#e0a355;">Save<span style="color:#18140e;">boxd</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#18140e;">${greeting}</p>
                <div style="font-size:15px;line-height:1.6;color:#4a4335;">${bodyHtml}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px;">
                ${ctaBlock}
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:12px;color:#a89b83;">Saveboxd</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
