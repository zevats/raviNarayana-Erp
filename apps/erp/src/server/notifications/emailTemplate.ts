/**
 * Production-ready transactional email templates for Ravinarayan ERP.
 * Adheres strictly to table-based HTML, inline styles, responsive viewports,
 * high-contrast typography, and full compatibility with major email clients.
 */

export interface OtpEmailProps {
  otp: string;
  recipientEmail?: string;
  expiresInMinutes?: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Escapes HTML characters to prevent XSS / markup injection in email clients.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Renders the authoritative Ravinarayan ERP Two-Factor Verification Code email.
 */
export function renderOtpEmail(props: OtpEmailProps): RenderedEmail {
  const safeOtp = escapeHtml(props.otp.trim());
  const expiryMinutes = props.expiresInMinutes || 10;
  const safeRecipient = props.recipientEmail ? escapeHtml(props.recipientEmail.trim()) : "";

  const subject = "Your Ravinarayan ERP Verification Code";

  const text = [
    "RAVINARAYAN ERP — TWO-FACTOR VERIFICATION",
    "==========================================",
    "",
    "A sign-in attempt was initiated for your authorized administrator account.",
    "",
    `Your 6-digit verification code is: ${props.otp.trim()}`,
    "",
    `This verification code is valid for ${expiryMinutes} minutes and can only be used once.`,
    "Enter this code on the management portal login screen to access your account.",
    "",
    "SECURITY NOTICE:",
    "If you did not initiate this sign-in attempt, please disregard this email.",
    "Your credentials remain safe. Never share this code with anyone.",
    "",
    "------------------------------------------",
    "Ravinarayan PG Guesthouse & Management ERP",
    "Internal Operations &bull; Confidential",
  ].join("\n");

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #FAF8F5; }
    @media only screen and (max-width: 620px) {
      .container-table { width: 100% !important; max-width: 100% !important; }
      .content-cell { padding: 24px 20px !important; }
      .otp-display { font-size: 30px !important; letter-spacing: 8px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #FAF8F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <!-- Outer Wrapper Table -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FAF8F5; width: 100%;">
    <tr>
      <td align="center" style="padding: 40px 16px 48px 16px;">
        <!-- Email Container (Max 580px) -->
        <table role="presentation" class="container-table" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; width: 100%; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E6E0D2; overflow: hidden; box-shadow: 0 4px 16px rgba(26, 46, 32, 0.05);">
          
          <!-- Brand Header Banner -->
          <tr>
            <td style="background-color: #1A2E20; padding: 28px 32px; text-align: center;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <span style="display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #C89F6B; margin-bottom: 6px;">
                      MANAGEMENT &bull; PORTAL
                    </span>
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.02em; font-family: Georgia, 'Times New Roman', serif;">
                      Ravinarayan ERP
                    </h1>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #A8B9A1; font-weight: 400;">
                      Internal Operations &amp; Management System
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Gold Accent Border Line -->
          <tr>
            <td height="3" style="background-color: #B58A57; line-height: 3px; font-size: 3px;">&nbsp;</td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td class="content-cell" style="padding: 36px 36px 32px 36px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                
                <!-- Action Title -->
                <tr>
                  <td style="padding-bottom: 16px;">
                    <h2 style="margin: 0; font-size: 19px; font-weight: 700; color: #1A2E20; letter-spacing: -0.01em;">
                      Two-Factor Authentication
                    </h2>
                    <p style="margin: 8px 0 0 0; font-size: 14px; line-height: 22px; color: #445448;">
                      A secure sign-in attempt was initiated for your authorized administrator account${safeRecipient ? ` (<strong style="color: #1A2E20;">${safeRecipient}</strong>)` : ""}. Use the single-use verification code below to verify your identity.
                    </p>
                  </td>
                </tr>

                <!-- Prominent OTP Code Block -->
                <tr>
                  <td align="center" style="padding: 20px 0 24px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FAF9F6; border: 1px solid #D5CEBF; border-radius: 12px;">
                      <tr>
                        <td align="center" style="padding: 24px 16px 20px 16px;">
                          <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #654735; margin-bottom: 8px;">
                            SECURITY VERIFICATION CODE
                          </div>
                          <div class="otp-display" style="font-family: 'Courier New', Courier, Consolas, monospace; font-size: 38px; font-weight: 700; letter-spacing: 12px; color: #1A2E20; line-height: 1.2; text-indent: 12px;">
                            ${safeOtp}
                          </div>
                          <div style="margin-top: 12px; font-size: 12px; font-weight: 500; color: #5D7656;">
                            Valid for ${expiryMinutes} minutes &bull; Single-use only
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Instructions -->
                <tr>
                  <td style="padding-bottom: 24px;">
                    <p style="margin: 0; font-size: 13px; line-height: 20px; color: #445448;">
                      Enter this 6-digit code on the portal verification screen. Once entered, your secure session will be activated automatically.
                    </p>
                  </td>
                </tr>

                <!-- Security Alert Box -->
                <tr>
                  <td style="padding: 16px; background-color: #F8F5EE; border-left: 3px solid #B58A57; border-radius: 4px;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td>
                          <p style="margin: 0; font-size: 12px; line-height: 18px; color: #654735; font-weight: 600;">
                            Security Notice
                          </p>
                          <p style="margin: 4px 0 0 0; font-size: 12px; line-height: 18px; color: #5B6B5F;">
                            If you did not request this verification code, please ignore this email. Your password has not been compromised. Never disclose this code to anyone.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Subtle Divider -->
          <tr>
            <td height="1" style="background-color: #E6E0D2; line-height: 1px; font-size: 1px;">&nbsp;</td>
          </tr>

          <!-- Footer Information -->
          <tr>
            <td style="background-color: #FAF8F5; padding: 22px 36px; text-align: center;">
              <p style="margin: 0; font-size: 11px; line-height: 17px; color: #738475;">
                This automated security notification was sent by <strong>Ravinarayan ERP</strong>.<br />
                Ravinarayan PG Guesthouse &bull; Operations &amp; Management &bull; Internal System
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject,
    html,
    text,
  };
}
