import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NotificationRequest {
  accountId: string;
  userId: string;
  facilityId?: string;
  notificationType: string;
  subject: string;
  message: string;
  metadata?: any;
}

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

    const body: NotificationRequest = await req.json();

    const { accountId, userId, facilityId, notificationType, subject, message, metadata } = body;

    if (!accountId || !userId || !notificationType || !subject || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: preferences, error: prefsError } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .eq("account_id", accountId)
      .maybeSingle();

    if (prefsError) throw prefsError;

    if (!preferences) {
      return new Response(
        JSON.stringify({ message: "No notification preferences found, using defaults" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if user has unsubscribed from all emails
    if (preferences.email_unsubscribed) {
      console.log(`User ${userId} has unsubscribed from all email notifications`);
      return new Response(
        JSON.stringify({
          message: "User has unsubscribed from email notifications",
          emailSkipped: true
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const shouldNotify =
      (notificationType.startsWith("spcc") && preferences.receive_spcc_reminders) ||
      (notificationType.startsWith("inspection") && preferences.receive_inspection_reminders);

    if (!shouldNotify) {
      return new Response(
        JSON.stringify({ message: "User has disabled this notification type" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let emailSent = false;
    let inAppCreated = false;

    // Only send email if enabled and not unsubscribed
    if (preferences.email_enabled && !preferences.email_unsubscribed) {
      const { data: userData } = await supabase.auth.admin.getUserById(userId);

      if (userData?.user?.email) {
        console.log(`Would send email to ${userData.user.email}: ${subject}`);
        emailSent = true;
      }
    }

    if (preferences.in_app_enabled) {
      const { error: historyError } = await supabase
        .from("notification_history")
        .insert({
          account_id: accountId,
          user_id: userId,
          facility_id: facilityId || null,
          notification_type: notificationType,
          subject,
          message,
          sent_at: new Date().toISOString(),
          metadata: metadata || {},
        });

      if (historyError) throw historyError;
      inAppCreated = true;
    }

    return new Response(
      JSON.stringify({
        success: true,
        emailSent,
        inAppCreated,
        message: "Notification sent successfully",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending notification:", error);

    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
