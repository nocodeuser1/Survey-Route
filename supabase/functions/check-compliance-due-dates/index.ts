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

      const { data: upcomingDue, error: upcomingError } = await supabase.rpc(
        "get_upcoming_due_facilities",
        {
          p_account_id: account.id,
          p_days_ahead: 90,
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

          const reminderDays = pref.reminder_days_before || [30, 14, 7, 1];
          const shouldSendReminder = reminderDays.includes(facility.days_until_due);

          if (!shouldSendReminder) continue;

          let subject = "";
          let message = "";

          if (facility.notification_type === "spcc") {
            if (facility.status === "initial_due") {
              subject = `SPCC Initial Plan Due for ${facility.facility_name}`;
              message = `The initial SPCC plan for ${facility.facility_name} is due in ${facility.days_until_due} days (${new Date(facility.due_date).toLocaleDateString()}). The plan must be completed within 6 months of the Initial Production Date.`;
            } else if (facility.status === "renewal_due") {
              subject = `SPCC Renewal Required for ${facility.facility_name}`;
              message = `The SPCC plan renewal for ${facility.facility_name} is due in ${facility.days_until_due} days (${new Date(facility.due_date).toLocaleDateString()}). SPCC plans must be renewed every 5 years.`;
            } else if (facility.status === "overdue") {
              subject = `URGENT: SPCC Plan Overdue for ${facility.facility_name}`;
              message = `The SPCC plan for ${facility.facility_name} is overdue by ${Math.abs(facility.days_until_due)} days. Immediate action is required to maintain compliance.`;
            }
          } else if (facility.notification_type === "inspection") {
            if (facility.status === "overdue") {
              subject = `URGENT: Inspection Overdue for ${facility.facility_name}`;
              message = `The inspection for ${facility.facility_name} is overdue by ${Math.abs(facility.days_until_due)} days. Please schedule and complete the inspection as soon as possible.`;
            } else {
              subject = `Inspection Due Soon for ${facility.facility_name}`;
              message = `An inspection for ${facility.facility_name} is due in ${facility.days_until_due} days (${new Date(facility.due_date).toLocaleDateString()}). Please schedule the inspection to maintain compliance.`;
            }
          }

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

          if (pref.email_enabled) {
            console.log(`Would send email to user ${pref.user_id}: ${subject}`);
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
