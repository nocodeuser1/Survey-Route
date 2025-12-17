import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "re_GVnafrs7_6Y3Z7ydBrPFRbMeBVKWBDpLT";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting compliance due dates check...");

    const { data: accounts, error: accountsError } = await supabase
      .from("accounts")
      .select("id, account_name")
      .eq("status", "active");

    if (accountsError) throw accountsError;

    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active accounts found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let totalNotificationsSent = 0;

    for (const account of accounts) {
      console.log(`Processing account: ${account.account_name} (${account.id})`);

      // Fetch Company Notification Settings
      const { data: companySettings } = await supabase
        .from("company_notification_settings")
        .select("*")
        .eq("account_id", account.id)
        .maybeSingle();

      // Default intervals if not set (fallback)
      const spccCreationReminders = companySettings?.spcc_plan_creation_reminders || [90, 60, 30, 15, 1];
      const spccRenewalReminders = companySettings?.spcc_plan_renewal_reminders || [90, 60, 30, 15, 1];
      const inspectionReminders = companySettings?.spcc_annual_inspection_reminders || [30, 14, 7, 1];

      // Determine max lookahead days
      const maxLookahead = Math.max(
        ...spccCreationReminders,
        ...spccRenewalReminders,
        ...inspectionReminders
      );

      const { data: upcomingDue, error: upcomingError } = await supabase.rpc(
        "get_upcoming_due_facilities",
        {
          p_account_id: account.id,
          p_days_ahead: maxLookahead + 1, // Add buffer
          p_notification_type: null,
        }
      );

      if (upcomingError) {
        console.error(`Error getting upcoming facilities for ${account.id}:`, upcomingError);
        continue;
      }

      if (!upcomingDue || upcomingDue.length === 0) {
        console.log(`No upcoming due facilities for account ${account.id}`);
        continue;
      }

      console.log(`Found ${upcomingDue.length} facilities with upcoming due dates`);

      const { data: preferences, error: prefsError } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("account_id", account.id);

      if (prefsError) {
        console.error(`Error getting preferences for ${account.id}:`, prefsError);
        continue;
      }

      for (const facility of upcomingDue) {
        // Determine which reminder schedule to use
        let reminderDays: number[] = [];
        if (facility.notification_type === "spcc") {
          if (facility.status === "initial_due") reminderDays = spccCreationReminders;
          else if (facility.status === "renewal_due") reminderDays = spccRenewalReminders;
          else if (facility.status === "overdue") reminderDays = [1, 7, 14, 30]; // Default overdue reminders
        } else {
          reminderDays = inspectionReminders;
        }

        // Check if today matches any reminder day
        const shouldSendReminder = reminderDays.includes(facility.days_until_due);

        // Also send if overdue (every 7 days or just once? Let's stick to the check above for now, or add explicit overdue handling)
        // For now, we rely on the exact match of days_until_due. 
        // Note: days_until_due is positive for future, negative for past.
        // If overdue, days_until_due is negative. The arrays above are positive.
        // So we need to handle overdue separately or assume the user wants reminders *before* the due date.
        // The requirement says "reminders 1 Day, 15 Days...". These are "before".
        // So we only send if days_until_due > 0 and matches.

        if (!shouldSendReminder) continue;

        for (const pref of preferences || []) {
          const shouldNotify =
            (facility.notification_type === "spcc" && pref.receive_spcc_reminders) ||
            (facility.notification_type === "inspection" && pref.receive_inspection_reminders);

          if (!shouldNotify) continue;

          if (pref.notify_for_team_only) {
            const { data: userTeam } = await supabase
              .from("account_users")
              .select("team_assignment")
              .eq("user_id", pref.user_id)
              .eq("account_id", account.id)
              .maybeSingle();

            const { data: facilityData } = await supabase
              .from("facilities")
              .select("team_assignment")
              .eq("id", facility.facility_id)
              .maybeSingle();

            if (userTeam?.team_assignment !== facilityData?.team_assignment) {
              continue;
            }
          }

          let subject = "";
          let message = "";
          let emailHtml = "";

          const daysText = facility.days_until_due === 1 ? "1 day" : `${facility.days_until_due} days`;
          const dueDateStr = new Date(facility.due_date).toLocaleDateString();

          if (facility.notification_type === "spcc") {
            if (facility.status === "initial_due") {
              subject = `Action Required: SPCC Plan Due in ${daysText} - ${facility.facility_name}`;
              message = `The initial SPCC plan for ${facility.facility_name} is due in ${daysText} (${dueDateStr}).`;
            } else if (facility.status === "renewal_due") {
              subject = `Renewal Reminder: SPCC Plan Due in ${daysText} - ${facility.facility_name}`;
              message = `The SPCC plan renewal for ${facility.facility_name} is due in ${daysText} (${dueDateStr}).`;
            }
          } else if (facility.notification_type === "inspection") {
            subject = `Inspection Reminder: Due in ${daysText} - ${facility.facility_name}`;
            message = `An annual inspection for ${facility.facility_name} is due in ${daysText} (${dueDateStr}).`;
          }

          // Generate HTML Email
          emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px; background-color: #1e293b; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">Survey-Route</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="margin-bottom: 24px;">
                <span style="background-color: ${facility.notification_type === 'spcc' ? '#fee2e2' : '#dbeafe'}; color: ${facility.notification_type === 'spcc' ? '#991b1b' : '#1e40af'}; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
                  ${facility.notification_type === 'spcc' ? 'Compliance Alert' : 'Inspection Reminder'}
                </span>
              </div>
              
              <h2 style="margin: 0 0 16px; color: #111827; font-size: 20px; font-weight: 600; line-height: 1.4;">
                ${subject}
              </h2>
              
              <p style="margin: 0 0 24px; color: #4b5563; font-size: 16px; line-height: 1.6;">
                ${message}
              </p>

              <div style="background-color: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 32px; border: 1px solid #e5e7eb;">
                <table style="width: 100%;">
                  <tr>
                    <td style="padding-bottom: 8px; color: #6b7280; font-size: 14px;">Facility</td>
                    <td style="padding-bottom: 8px; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${facility.facility_name}</td>
                  </tr>
                  <tr>
                    <td style="padding-bottom: 8px; color: #6b7280; font-size: 14px;">Due Date</td>
                    <td style="padding-bottom: 8px; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">${dueDateStr}</td>
                  </tr>
                  <tr>
                    <td style="color: #6b7280; font-size: 14px;">Time Remaining</td>
                    <td style="color: #ef4444; font-size: 14px; font-weight: 600; text-align: right;">${daysText}</td>
                  </tr>
                </table>
              </div>

              <a href="https://app.survey-route.com" style="display: block; width: 100%; background-color: #2563eb; color: #ffffff; text-align: center; padding: 16px 0; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
                View Facility Details
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 32px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px;">
                You are receiving this email because of your notification preferences in Survey-Route.
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} Survey-Route. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
          `;

          if (pref.in_app_enabled) {
            await supabase.from("notification_history").insert({
              account_id: account.id,
              user_id: pref.user_id,
              facility_id: facility.facility_id,
              notification_type:
                facility.notification_type === "spcc"
                  ? facility.status === "initial_due"
                    ? "spcc_initial_due"
                    : facility.status === "renewal_due"
                      ? "spcc_renewal_due"
                      : "spcc_overdue"
                  : facility.status === "overdue"
                    ? "inspection_overdue"
                    : "inspection_due",
              subject,
              message,
              sent_at: new Date().toISOString(),
              metadata: {
                facility_name: facility.facility_name,
                due_date: facility.due_date,
                days_until_due: facility.days_until_due,
                status: facility.status,
              },
            });

            totalNotificationsSent++;
          }

          if (pref.email_enabled && !pref.email_unsubscribed) {
            const { data: userData } = await supabase.auth.admin.getUserById(pref.user_id);

            if (userData?.user?.email) {
              console.log(`Sending email to ${userData.user.email}: ${subject}`);

              const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${RESEND_API_KEY}`,
                },
                body: JSON.stringify({
                  from: "Survey-Route <notifications@mail.survey-route.com>",
                  to: [userData.user.email],
                  subject: subject,
                  html: emailHtml,
                }),
              });

              if (!res.ok) {
                const err = await res.json();
                console.error("Failed to send email via Resend:", err);
              } else {
                totalNotificationsSent++;
              }
            }
          }

          if (facility.notification_type === "spcc") {
            await supabase
              .from("spcc_compliance_tracking")
              .update({ notification_sent_at: new Date().toISOString() })
              .eq("facility_id", facility.facility_id);
          } else if (facility.notification_type === "inspection") {
            await supabase
              .from("facilities")
              .update({ inspection_due_notification_sent_at: new Date().toISOString() })
              .eq("id", facility.facility_id);
          }
        }
      }
    }

    console.log(`Completed. Total notifications sent: ${totalNotificationsSent}`);

    return new Response(
      JSON.stringify({
        success: true,
        accountsProcessed: accounts.length,
        notificationsSent: totalNotificationsSent,
        message: "Compliance check completed successfully",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error checking compliance due dates:", error);

    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
