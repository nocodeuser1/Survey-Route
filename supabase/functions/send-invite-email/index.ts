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

    const emailHtml = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Join ${safeAccountName} on Survey Route</title>
  </head>
  <body style="margin:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr><td style="background:#2563eb;color:#ffffff;padding:30px;text-align:center;">
            <div style="font-size:26px;font-weight:700;">Survey Route</div>
            <div style="font-size:14px;margin-top:6px;color:#dbeafe;">Account invitation</div>
          </td></tr>
          <tr><td style="padding:34px;">
            <h1 style="font-size:24px;line-height:1.25;margin:0 0 18px;">Join ${safeAccountName}</h1>
            <p style="font-size:16px;line-height:1.6;margin:0 0 14px;color:#4b5563;">
              <strong>${safeInviterName}</strong> invited you to Survey Route as a <strong>${safeRole}</strong>.
            </p>
            <p style="font-size:14px;line-height:1.6;margin:0 0 26px;color:#4b5563;">
              This invitation grants access only to ${safeAccountName}.
            </p>
            <div style="text-align:center;margin:0 0 26px;">
              <a href="${safeAcceptUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:9px;">Accept Invitation</a>
            </div>
            <p style="font-size:12px;line-height:1.6;margin:0;color:#6b7280;word-break:break-all;">
              If the button does not work, open this link:<br>${safeAcceptUrl}
            </p>
            <p style="font-size:12px;line-height:1.6;margin:18px 0 0;color:#6b7280;">
              This link expires in 7 days. If you did not expect this invitation, you can ignore this email.
            </p>
          </td></tr>
          <tr><td style="padding:20px 34px;border-top:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:12px;">
            &copy; ${currentYear} Survey Route
            ${unsubscribeUrl ? `<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe from email</a>` : ""}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

    const emailText = `${inviterName} invited you to join ${accountName} on Survey Route as a ${role}.

This invitation grants access only to ${accountName}.

Accept the invitation: ${acceptUrl.toString()}

This link expires in 7 days. If you did not expect this invitation, you can ignore this email.`;

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
        subject: `You're invited to join ${accountName} on Survey Route`,
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
