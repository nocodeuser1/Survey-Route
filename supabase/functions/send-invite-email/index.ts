import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface InviteEmailRequest {
  inviteeEmail: string;
  inviterName: string;
  accountName: string;
  inviteToken: string;
  role: string;
  acceptUrl: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { inviteeEmail, inviterName, accountName, inviteToken, role, acceptUrl } = await req.json() as InviteEmailRequest;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "re_GVnafrs7_6Y3Z7ydBrPFRbMeBVKWBDpLT";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const APP_URL = acceptUrl.split('/accept-invite')[0]; // Extract base app URL

    if (!acceptUrl) {
      throw new Error("acceptUrl is required");
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if user has unsubscribed (look up by email in users table first)
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('email', inviteeEmail)
      .maybeSingle();

    let unsubscribeToken: string | null = null;

    if (userData) {
      // User exists, check their notification preferences
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('email_unsubscribed, unsubscribe_token')
        .eq('user_id', userData.id)
        .maybeSingle();

      if (prefs?.email_unsubscribed) {
        console.log(`User ${inviteeEmail} has unsubscribed. Skipping email.`);
        return new Response(
          JSON.stringify({ success: false, message: 'User has unsubscribed from emails' }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      unsubscribeToken = prefs?.unsubscribe_token || null;
    }

    console.log(`Sending invitation to ${inviteeEmail} with acceptUrl: ${acceptUrl}`);

    const unsubscribeUrl = unsubscribeToken
      ? `${APP_URL}/unsubscribe?token=${unsubscribeToken}`
      : `${APP_URL}/unsubscribe`;

    const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to Survey Route</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; background-color: #2563eb; border-radius: 8px 8px 0 0;">
              <div style="margin: 0 0 10px;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block;">
                  <path d="M9 11L12 14L22 4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M21 12V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">Survey-Route</h1>
              <p style="margin: 8px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">Professional Facility Inspection Management</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 24px; font-weight: 600;">You've Been Invited!</h2>

              <p style="margin: 0 0 16px; color: #4a5568; font-size: 16px; line-height: 1.6;">
                <strong>${inviterName}</strong> has invited you to join <strong>${accountName}</strong> on Survey-Route as a <strong>${role}</strong>.
              </p>

              <p style="margin: 0 0 28px; color: #4a5568; font-size: 16px; line-height: 1.6;">
                Survey-Route helps teams manage facility inspections, route planning, and compliance tracking all in one place.
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 0 0 28px;">
                <tr>
                  <td align="center">
                    <a href="${acceptUrl}" style="display: inline-block; padding: 16px 40px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px; color: #718096; font-size: 14px; line-height: 1.5;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 24px; color: #2563eb; font-size: 14px; word-break: break-all;">
                ${acceptUrl}
              </p>

              <div style="margin: 24px 0 0; padding: 20px; background-color: #f7fafc; border-radius: 6px; border-left: 4px solid #2563eb;">
                <p style="margin: 0; color: #4a5568; font-size: 14px; line-height: 1.5;">
                  <strong>Note:</strong> This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f7fafc; border-radius: 0 0 8px 8px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 8px; color: #718096; font-size: 14px;">
                © 2024 Survey-Route. All rights reserved.
              </p>
              <p style="margin: 0 0 12px; color: #a0aec0; font-size: 12px;">
                Professional facility inspection and compliance management
              </p>
              <p style="margin: 0 0 8px; color: #a0aec0; font-size: 12px;">
                Survey-Route LLC, 123 Business Park Dr, Suite 100, Austin, TX 78701
              </p>
              ${unsubscribeToken ? `
              <p style="margin: 0; color: #a0aec0; font-size: 12px;">
                <a href="${unsubscribeUrl}" style="color: #2563eb; text-decoration: underline;">Unsubscribe from these emails</a>
              </p>
              ` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const emailText = `
You've Been Invited to Survey-Route!

${inviterName} has invited you to join ${accountName} on Survey-Route as a ${role}.

Survey-Route helps teams manage facility inspections, route planning, and compliance tracking all in one place.

To accept this invitation, visit:
${acceptUrl}

Note: This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.

---
© 2024 Survey-Route. All rights reserved.
Professional facility inspection and compliance management

Survey-Route LLC
123 Business Park Dr, Suite 100
Austin, TX 78701

${unsubscribeToken ? `Unsubscribe: ${unsubscribeUrl}` : ''}
    `;

    // Build email headers for better deliverability
    const emailHeaders: Record<string, string> = {
      "Precedence": "bulk",
      "Auto-Submitted": "auto-generated",
      "X-Mailer": "Survey-Route",
      "X-Entity-Ref-ID": inviteToken,
    };

    // Add List-Unsubscribe headers if we have a token
    if (unsubscribeToken) {
      emailHeaders["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
      emailHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Survey-Route <invites@mail.survey-route.com>",
        to: [inviteeEmail],
        subject: `You're invited to join ${accountName} on Survey-Route`,
        html: emailHtml,
        text: emailText,
        headers: emailHeaders,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Resend API error: ${JSON.stringify(data)}`);
    }

    return new Response(
      JSON.stringify({ success: true, emailId: data.id }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error sending invite email:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Failed to send invitation email" 
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
