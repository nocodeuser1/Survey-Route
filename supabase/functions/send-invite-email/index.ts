import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function headerSafe(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) {
      return jsonResponse({ error: "Authentication is required" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appUrl = Deno.env.get("APP_URL") || "https://survey-route.com";

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey) {
      console.error("send-invite-email is missing required environment configuration");
      return jsonResponse({ error: "Invitation email service is not configured" }, 500);
    }

    const { inviteToken } = await req.json() as { inviteToken?: string };
    if (!inviteToken || inviteToken.length < 20 || inviteToken.length > 200) {
      return jsonResponse({ error: "A valid invitation token is required" }, 400);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user: caller }, error: callerError } = await userClient.auth.getUser();
    if (callerError || !caller?.email) {
      return jsonResponse({ error: "Authentication is required" }, 401);
    }

    const { data: invitation, error: invitationError } = await adminClient
      .from("user_invitations")
      .select("id, email, account_id, role, invited_by, status, expires_at")
      .eq("token", inviteToken)
      .maybeSingle();

    if (invitationError || !invitation) {
      return jsonResponse({ error: "Invitation not found" }, 404);
    }

    if (invitation.status !== "pending" || new Date(invitation.expires_at) <= new Date()) {
      return jsonResponse({ error: "Invitation is no longer active" }, 409);
    }

    const { data: callerProfile } = await adminClient
      .from("users")
      .select("id")
      .eq("auth_user_id", caller.id)
      .maybeSingle();

    if (!callerProfile) {
      return jsonResponse({ error: "User profile not found" }, 403);
    }

    const { data: account } = await adminClient
      .from("accounts")
      .select("account_name, company_name, agency_id")
      .eq("id", invitation.account_id)
      .maybeSingle();

    if (!account) {
      return jsonResponse({ error: "Account not found" }, 404);
    }

    const [{ data: adminMembership }, { data: agency }, { data: coOwner }] = await Promise.all([
      adminClient
        .from("account_users")
        .select("id")
        .eq("account_id", invitation.account_id)
        .eq("user_id", callerProfile.id)
        .eq("role", "account_admin")
        .maybeSingle(),
      adminClient
        .from("agencies")
        .select("owner_email")
        .eq("id", account.agency_id)
        .maybeSingle(),
      adminClient
        .from("agency_co_owners")
        .select("id")
        .eq("agency_id", account.agency_id)
        .eq("user_id", callerProfile.id)
        .maybeSingle(),
    ]);

    const callerEmail = caller.email.toLowerCase();
    const authorized = Boolean(
      adminMembership
      || coOwner
      || agency?.owner_email?.toLowerCase() === callerEmail,
    );

    if (!authorized) {
      return jsonResponse({ error: "Not authorized to send this invitation" }, 403);
    }

    const { data: inviter } = await adminClient
      .from("users")
      .select("full_name")
      .eq("id", invitation.invited_by)
      .maybeSingle();

    const { data: inviteeProfile } = await adminClient
      .from("users")
      .select("id")
      .eq("email", invitation.email.toLowerCase())
      .maybeSingle();

    let unsubscribeToken: string | null = null;
    if (inviteeProfile) {
      const { data: preferences } = await adminClient
        .from("notification_preferences")
        .select("email_unsubscribed, unsubscribe_token")
        .eq("user_id", inviteeProfile.id)
        .maybeSingle();

      if (preferences?.email_unsubscribed) {
        return jsonResponse({ success: false, message: "Recipient has unsubscribed from email" }, 409);
      }
      unsubscribeToken = preferences?.unsubscribe_token || null;
    }

    const baseUrl = new URL(appUrl);
    const acceptUrl = new URL("/accept-invite", baseUrl);
    acceptUrl.searchParams.set("token", inviteToken);
    const unsubscribeUrl = unsubscribeToken
      ? new URL(`/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`, baseUrl).toString()
      : null;

    const accountName = headerSafe(account.company_name || account.account_name || "Survey Route");
    const inviterName = headerSafe(inviter?.full_name || "Your account administrator");
    const role = invitation.role === "account_admin" ? "Account administrator" : "Team member";
    const safeAccountName = escapeHtml(accountName);
    const safeInviterName = escapeHtml(inviterName);
    const safeRole = escapeHtml(role);
    const safeAcceptUrl = escapeHtml(acceptUrl.toString());
    const currentYear = new Date().getUTCFullYear();

    // "Camino" -> "Camino's"; "Jones" -> "Jones'"
    const workspaceName = /s$/i.test(accountName) ? `${accountName}'` : `${accountName}'s`;
    const safeWorkspaceName = escapeHtml(workspaceName);

    // Brand lockup lives in public/ and is served from the site root, so it
    // resolves for any APP_URL (prod, staging, preview).
    const logoUrl = escapeHtml(new URL("/survey-route-logo.png", baseUrl).toString());
    // Show the real expiry date rather than a hardcoded "7 days" — the row's
    // expires_at is the source of truth and reads as a genuine record.
    const expiresLabel = escapeHtml(
      new Date(invitation.expires_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Chicago",
      }),
    );
    const preheader = escapeHtml(
      `${inviterName} invited you to ${accountName} on Survey Route as a ${role.toLowerCase()}. Link expires ${new Date(invitation.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}.`,
    );

    const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

    const emailHtml = `
<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Join ${safeAccountName} on Survey Route</title>
    <!--[if mso]>
    <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
    <![endif]-->
  </head>
  <body style="margin:0;padding:0;background:#eef2f7;font-family:${font};color:#0f172a;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}</div>
    <div style="display:none;max-height:0;overflow:hidden;">&#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847;</div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef2f7;">
      <tr><td align="center" style="padding:40px 16px;">

        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe3ee;">

          <!-- brand rule -->
          <tr><td style="height:4px;line-height:4px;font-size:0;background:#2563eb;">&nbsp;</td></tr>

          <!-- logo lockup on white: the mark reads as the real brand, and the
               alt text still says the name if images are blocked -->
          <tr><td align="center" style="padding:32px 32px 26px;">
            <img src="${logoUrl}" width="165" height="45" alt="Survey Route — by BEAR DATA"
                 style="display:block;border:0;outline:none;text-decoration:none;width:165px;height:auto;max-width:165px;font-family:${font};font-size:17px;font-weight:700;color:#0f172a;">
          </td></tr>

          <tr><td style="padding:0 40px;">
            <div style="height:1px;line-height:1px;font-size:0;background:#eef2f7;">&nbsp;</div>
          </td></tr>

          <tr><td style="padding:30px 40px 0;">
            <div style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#2563eb;">Account invitation</div>
            <h1 style="margin:12px 0 0;font-size:27px;line-height:1.22;font-weight:700;color:#0f172a;">
              Join ${safeWorkspaceName} Workspace
              <span style="display:block;margin-top:4px;font-size:19px;font-weight:600;color:#94a3b8;">in survey-route.com</span>
            </h1>
            <p style="margin:16px 0 0;font-size:16px;line-height:1.62;color:#475569;">
              <strong style="color:#0f172a;font-weight:600;">${safeInviterName}</strong> has invited you to collaborate on ${safeAccountName}.
            </p>
          </td></tr>

          <!-- the grant, as a record -->
          <tr><td style="padding:24px 40px 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <tr>
                <td style="padding:16px 20px 10px;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">Account</div>
                  <div style="margin-top:3px;font-size:15px;font-weight:600;color:#0f172a;">${safeAccountName}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:0 20px 10px;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">Your role</div>
                  <div style="margin-top:3px;font-size:15px;font-weight:600;color:#0f172a;">${safeRole}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:0 20px 16px;">
                  <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">Invited by</div>
                  <div style="margin-top:3px;font-size:15px;font-weight:600;color:#0f172a;">${safeInviterName}</div>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
              This invitation grants access to ${safeAccountName} only.
            </p>
          </td></tr>

          <!-- CTA -->
          <tr><td align="center" style="padding:28px 40px 0;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeAcceptUrl}" style="height:50px;v-text-anchor:middle;width:260px;" arcsize="20%" stroke="f" fillcolor="#2563eb">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:${font};font-size:16px;font-weight:700;">Accept invitation</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${safeAcceptUrl}"
               style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;line-height:1;padding:17px 40px;border-radius:10px;font-family:${font};">
              Accept invitation
            </a>
            <!--<![endif]-->
            <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">
              Expires ${expiresLabel}
            </p>
          </td></tr>

          <!-- fallback link -->
          <tr><td style="padding:26px 40px 0;">
            <div style="font-size:12px;font-weight:600;color:#64748b;">Button not working? Paste this into your browser:</div>
            <div style="margin-top:8px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;line-height:1.5;color:#2563eb;word-break:break-all;">
              ${safeAcceptUrl}
            </div>
          </td></tr>

          <tr><td style="padding:24px 40px 0;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
              If you weren&rsquo;t expecting this invitation, you can safely ignore this email &mdash; no account will be created.
            </p>
          </td></tr>

          <!-- footer -->
          <tr><td style="padding:28px 40px 32px;">
            <div style="height:1px;line-height:1px;font-size:0;background:#eef2f7;">&nbsp;</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr><td align="center" style="padding-top:20px;">
                <div style="font-size:13px;font-weight:700;color:#334155;letter-spacing:-.01em;">Survey Route</div>
                <div style="margin-top:3px;font-size:11px;color:#94a3b8;letter-spacing:.05em;">by BEAR Data</div>
                <div style="margin-top:12px;font-size:11px;color:#b6c2d2;">
                  &copy; ${currentYear} Survey Route${unsubscribeUrl ? ` &nbsp;&middot;&nbsp; <a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>` : ""}
                </div>
              </td></tr>
            </table>
          </td></tr>

        </table>

      </td></tr>
    </table>
  </body>
</html>`;

    const plainExpires = new Date(invitation.expires_at).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Chicago",
    });

    const emailText = `SURVEY ROUTE — by BEAR Data
Account invitation

Join ${workspaceName} Workspace in survey-route.com

${inviterName} has invited you to collaborate on ${accountName} in Survey Route.

  Workspace:   ${accountName}
  Your role:   ${role}
  Invited by:  ${inviterName}

This invitation grants access to ${accountName} only.

Accept the invitation:
${acceptUrl.toString()}

Expires ${plainExpires}.

If you weren't expecting this invitation, you can safely ignore this email — no account will be created.

© ${currentYear} Survey Route${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}`;

    const emailHeaders: Record<string, string> = {
      "Auto-Submitted": "auto-generated",
      "X-Entity-Ref-ID": invitation.id,
    };
    if (unsubscribeUrl) {
      emailHeaders["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
      emailHeaders["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "Survey Route <invites@mail.survey-route.com>",
        to: [invitation.email],
        subject: `Join ${workspaceName} Workspace in survey-route.com`,
        html: emailHtml,
        text: emailText,
        headers: emailHeaders,
      }),
    });

    const responseData = await response.json();
    if (!response.ok) {
      console.error("Resend rejected invitation email", response.status, responseData);
      return jsonResponse({ error: "Email provider rejected the invitation" }, 502);
    }

    return jsonResponse({ success: true, emailId: responseData.id });
  } catch (error) {
    console.error("send-invite-email failed", error);
    return jsonResponse({ error: "Failed to send invitation email" }, 500);
  }
});
