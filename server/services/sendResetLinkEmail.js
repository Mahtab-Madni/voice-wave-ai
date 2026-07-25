import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

// Create transporter with your email service
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const waveMarkHtml = `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table; vertical-align:middle;">
    <tr>
      <td style="padding:0 1px; vertical-align:middle;"><div style="width:3px;height:7px;background-color:#2554C7;border-radius:1.5px;font-size:0;line-height:0;">&nbsp;</div></td>
      <td style="padding:0 1px; vertical-align:middle;"><div style="width:3px;height:13px;background-color:#2554C7;border-radius:1.5px;font-size:0;line-height:0;">&nbsp;</div></td>
      <td style="padding:0 1px; vertical-align:middle;"><div style="width:3px;height:19px;background-color:#2554C7;border-radius:1.5px;font-size:0;line-height:0;">&nbsp;</div></td>
      <td style="padding:0 1px; vertical-align:middle;"><div style="width:3px;height:13px;background-color:#2554C7;border-radius:1.5px;font-size:0;line-height:0;">&nbsp;</div></td>
      <td style="padding:0 1px; vertical-align:middle;"><div style="width:3px;height:7px;background-color:#2554C7;border-radius:1.5px;font-size:0;line-height:0;">&nbsp;</div></td>
    </tr>
  </table>
`;

// Send password reset email
export async function sendResetLinkEmail(email, resetUrl, userName) {
  const mailOptions = {
    from: `Voice-wave <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Reset your Voice-wave password",
    html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset - Voice-wave</title>
    </head>
    <body style="margin:0; padding:0; background-color:#f5f5f5; font-family:Arial, Helvetica, sans-serif; color:#171717;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f5; padding:24px 0;">
        <tr>
          <td align="center">
            <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px; width:100%; background-color:#ffffff; border:1px solid #e5e5e5; border-radius:8px;">

              <!-- Header -->
              <tr>
                <td align="center" style="padding:32px 32px 16px 32px;">
                  ${waveMarkHtml}
                  <div style="margin-top:10px; font-size:16px; font-weight:600; color:#171717;">Voice-wave</div>
                </td>
              </tr>

              <!-- Content -->
              <tr>
                <td style="padding:8px 32px 32px 32px;">
                  <h1 style="margin:0 0 8px 0; font-size:18px; font-weight:600; color:#171717;">Reset your password</h1>
                  <p style="margin:0 0 20px 0; font-size:14px; line-height:1.6; color:#525252;">
                    Hi ${userName || "there"}, we received a request to reset the password for your Voice-wave account. Click the button below to choose a new one.
                  </p>

                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                    <tr>
                      <td align="center" style="border-radius:6px; background-color:#2554C7;">
                        <a href="${resetUrl}" target="_blank" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:6px;">
                          Reset password
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:0 0 20px 0; font-size:13px; line-height:1.6; color:#737373;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <a href="${resetUrl}" style="color:#2554C7; text-decoration:none; word-break:break-all;">${resetUrl}</a>
                  </p>

                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9f9f9; border:1px solid #e5e5e5; border-radius:6px;">
                    <tr>
                      <td style="padding:14px 16px; font-size:13px; line-height:1.6; color:#525252;">
                        This link expires in <strong>10 minutes</strong>. If you didn't request a password reset, you can safely ignore this email — your password won't be changed.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:20px 32px; border-top:1px solid #e5e5e5;">
                  <p style="margin:0; font-size:12px; line-height:1.5; color:#a3a3a3; text-align:center;">
                    This is an automated email, please don't reply.<br>
                    &copy; ${new Date().getFullYear()} Voice-wave. All rights reserved.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `,
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log("Voice-wave password reset email sent successfully");
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error("Failed to send Voice-wave reset email");
  }
}
