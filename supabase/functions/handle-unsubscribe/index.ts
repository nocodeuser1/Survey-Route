import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Unsubscribe token is required' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find the notification preferences by token
    const { data: prefs, error: findError } = await supabase
      .from('notification_preferences')
      .select('id, user_id, email_unsubscribed')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (findError || !prefs) {
      console.error('Error finding preferences:', findError);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired unsubscribe token' }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Check if already unsubscribed
    if (prefs.email_unsubscribed) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Already unsubscribed',
          alreadyUnsubscribed: true 
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Update notification preferences to unsubscribe
    const { error: updateError } = await supabase
      .from('notification_preferences')
      .update({
        email_unsubscribed: true,
        email_enabled: false,
        unsubscribed_at: new Date().toISOString(),
      })
      .eq('id', prefs.id);

    if (updateError) {
      console.error('Error updating preferences:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to unsubscribe. Please try again.' }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Successfully unsubscribed from email notifications' 
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error('Error in handle-unsubscribe:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'An unexpected error occurred' 
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
