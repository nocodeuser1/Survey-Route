/**
 * Survey-Route AI Assistant — Supabase Edge Function
 *
 * Backs the floating chat bubble in the app. The frontend POSTs the user's
 * conversation + the active accountId; this function:
 *
 *   1. Verifies the user's JWT + their access to that account
 *      (covers the agency-owner pattern via the user_has_account_access SQL helper).
 *   2. Pulls a compact snapshot of every facility, inspection, and SPCC plan
 *      for the account — keys are abbreviated to keep the prompt cheap.
 *   3. Calls Claude (Opus 4.7, adaptive thinking) with a system prompt that
 *      teaches the model the SPCC compliance domain + the JSON shape.
 *   4. Streams the response back to the client as Server-Sent Events.
 *
 * Setup notes (one-time, per CLAUDE.md migration policy):
 *   1. In the Supabase dashboard → Edge Functions → Manage secrets, add
 *      ANTHROPIC_API_KEY with your real key.
 *   2. Deploy: `npx supabase functions deploy ai-assistant`
 *      (or via the dashboard's bulk deploy).
 *   3. The function requires NO migration — it only reads existing tables.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import Anthropic from 'npm:@anthropic-ai/sdk@0.40.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const anthropic = new Anthropic({
  apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RequestBody {
  accountId: string;
  messages: ChatMessage[];
}

/**
 * Compact field abbreviations keep tokens down. The system prompt below
 * documents what each key means so Claude can read the snapshot.
 */
type FacilitySnap = {
  name: string;
  ip?: string | null;   // first_prod_date
  due?: string | null;  // spcc_due_date
  pe?: string | null;   // spcc_pe_stamp_date
  rc?: string | null;   // recertified_date
  ins?: string | null;  // spcc_inspection_date
  ct?: string | null;   // spcc_completion_type
  ws?: string | null;   // spcc_workflow_status
  rd?: string | null;   // recertification_decision
  st?: string | null;   // status
  wells?: number;       // # of well slots filled
  county?: string | null;
};

async function loadSnapshot(accountId: string): Promise<{
  facilities: FacilitySnap[];
  totals: Record<string, number>;
}> {
  const { data: facs, error } = await supabase
    .from('facilities')
    .select('name, first_prod_date, spcc_due_date, spcc_pe_stamp_date, recertified_date, spcc_inspection_date, spcc_completion_type, spcc_workflow_status, recertification_decision, status, county, well_name_1, well_name_2, well_name_3, well_name_4, well_name_5, well_name_6')
    .eq('account_id', accountId)
    .order('name', { ascending: true });

  if (error) throw new Error(`facilities load failed: ${error.message}`);

  const facilities: FacilitySnap[] = (facs ?? []).map((f) => {
    const wells = [1, 2, 3, 4, 5, 6].filter((n) => f[`well_name_${n}`]).length;
    const snap: FacilitySnap = { name: f.name };
    if (f.first_prod_date) snap.ip = f.first_prod_date;
    if (f.spcc_due_date) snap.due = f.spcc_due_date;
    if (f.spcc_pe_stamp_date) snap.pe = f.spcc_pe_stamp_date;
    if (f.recertified_date) snap.rc = f.recertified_date;
    if (f.spcc_inspection_date) snap.ins = f.spcc_inspection_date;
    if (f.spcc_completion_type) snap.ct = f.spcc_completion_type;
    if (f.spcc_workflow_status) snap.ws = f.spcc_workflow_status;
    if (f.recertification_decision) snap.rd = f.recertification_decision;
    if (f.status && f.status !== 'active') snap.st = f.status;
    if (wells > 0) snap.wells = wells;
    if (f.county) snap.county = f.county;
    return snap;
  });

  // Totals are pre-computed for cheap aggregate questions ("how many facilities").
  const totals = {
    total: facilities.length,
    active: facilities.filter((f) => f.st !== 'sold').length,
    sold: facilities.filter((f) => f.st === 'sold').length,
    with_plan: facilities.filter((f) => f.pe).length,
    with_inspection: facilities.filter((f) => f.ins).length,
  };

  return { facilities, totals };
}

function buildSystemPrompt(snapshot: Awaited<ReturnType<typeof loadSnapshot>>): string {
  const today = new Date().toISOString().split('T')[0];
  return `You are the Survey-Route in-app assistant — an SPCC (Spill Prevention, Control, and Countermeasure) compliance helper for an oil & gas operator.

Today's date: ${today}

# SPCC compliance facts you must know
- SPCC plans are required at qualifying oil/gas facilities under 40 CFR §112.
- SPCC INSPECTIONS must be conducted ANNUALLY (40 CFR §112.7(c)). Inspections expire 1 year after the conducted date.
- SPCC PLAN RECERTIFICATION must happen every 5 YEARS by a Professional Engineer (40 CFR §112.5). The 5-year clock runs from the most recent recertified_date, or the original PE stamp date if never recertified.
- Initial Production date (IP / first_prod_date) is when a well first produced. The SPCC plan is due ~6 months after first production.
- "Due", "expiring", and "overdue" mean different things — be precise. The Survey-Route UI shows "expiring" within 90 days of the 5-year recert date and 60 days of the annual inspection.

# Data you have access to
You receive a JSON snapshot of EVERY facility in this user's account. The user can only ask about facilities in this snapshot.

Field abbreviations (every key may be missing if the value is null):
- name: facility name
- ip:   first_prod_date (initial production date, ISO yyyy-mm-dd)
- due:  spcc_due_date (when the initial SPCC plan is/was due)
- pe:   spcc_pe_stamp_date (date the current plan was PE-stamped)
- rc:   recertified_date (most recent 5-year recertification)
- ins:  spcc_inspection_date (last completed annual inspection)
- ct:   spcc_completion_type ('internal' = self-cert, 'external' = PE-cert)
- ws:   spcc_workflow_status ('awaiting_pe_stamp' | 'site_visited' | 'pe_stamped' | 'completed_uploaded')
- rd:   recertification_decision ('no_changes' | 'changes_found' | null)
- st:   status ('sold' if sold; missing means active)
- wells: count of named wells on this facility (1-6)
- county: county

Pre-computed totals (use these for whole-account questions instead of recounting):
${JSON.stringify(snapshot.totals)}

# How to answer
- Be SHORT and SPECIFIC. Lead with the number or direct answer; only list names when it's helpful.
- For dates, use M/D/YYYY (American format).
- "Due this year" means the calculated due date falls in the current calendar year.
- If a question is ambiguous (e.g. "due" — annual inspection vs. 5-year recert?), ask one short clarifying question rather than guessing.
- If no facilities match, say "No facilities match that" — don't fabricate.
- You can do simple math (counts, filtering by date windows). Show your reasoning ONLY when the user asks "how" or "why".
- Never invent fields that aren't in the snapshot. If the user asks about something we don't track (rainfall, ownership, etc.), say so.

# The snapshot
${JSON.stringify(snapshot.facilities)}`;
}

/**
 * Verify the caller has access to the requested account. Reuses the
 * `user_has_account_access` SQL helper that powers RLS, so this matches
 * the agency-owner + member pattern already enforced everywhere else.
 */
async function verifyAccountAccess(authUserId: string, accountId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('user_has_account_access', {
    p_account_id: accountId,
  }).eq('user_auth_id', authUserId);
  if (error) {
    // Fallback: hand-rolled join (covers older deployments without the helper).
    const { data: fallback } = await supabase
      .from('users')
      .select('id, is_agency_owner, account_users(account_id)')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (!fallback) return false;
    if (fallback.is_agency_owner) {
      // Agency owners: verify they own the agency that owns this account.
      const { data: acct } = await supabase
        .from('accounts')
        .select('agency_id, agencies!inner(owner_email)')
        .eq('id', accountId)
        .maybeSingle();
      if (!acct) return false;
      const { data: ownerUser } = await supabase
        .from('users')
        .select('email')
        .eq('id', fallback.id)
        .maybeSingle();
      // @ts-expect-error nested join
      return ownerUser?.email === acct.agencies?.owner_email;
    }
    // Regular user: must have an account_users membership row.
    const memberships = (fallback.account_users ?? []) as Array<{ account_id: string }>;
    return memberships.some((m) => m.account_id === accountId);
  }
  return Boolean(data);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return jsonResponse({ error: 'Invalid token' }, 401);

    const body = (await req.json()) as RequestBody;
    if (!body.accountId || typeof body.accountId !== 'string') {
      return jsonResponse({ error: 'accountId required' }, 400);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonResponse({ error: 'messages required' }, 400);
    }

    const hasAccess = await verifyAccountAccess(user.id, body.accountId);
    if (!hasAccess) {
      return jsonResponse({ error: 'No access to this account' }, 403);
    }

    const snapshot = await loadSnapshot(body.accountId);
    const systemPrompt = buildSystemPrompt(snapshot);

    // Cap conversation history at the last 12 turns. SPCC chats don't
    // benefit from more context and the snapshot already dwarfs the chat.
    const recentMessages = body.messages.slice(-12).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Stream the response. We forward Anthropic's text deltas as a
    // line-delimited stream so the client can render incrementally.
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      // Cache the big system prompt so subsequent turns within a 5-min
      // window only pay ~10% of input cost on the prefix.
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: recentMessages,
    });

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          stream.on('text', (delta: string) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: delta })}\n\n`));
          });
          const final = await stream.finalMessage();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', usage: final.usage })}\n\n`));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ai-assistant]', message);
    return jsonResponse({ error: message }, 500);
  }
});
