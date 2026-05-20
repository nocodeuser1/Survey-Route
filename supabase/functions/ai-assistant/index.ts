/**
 * Survey-Route AI Assistant — Supabase Edge Function (Gemini-backed)
 *
 * Backs the floating chat bubble in the app. The frontend POSTs the user's
 * conversation + the active accountId; this function:
 *
 *   1. Verifies the user's JWT + their access to that account
 *      (covers the agency-owner pattern via the user_has_account_access SQL helper).
 *   2. Pulls a compact snapshot of every facility, inspection, and SPCC plan
 *      for the account — keys are abbreviated to keep the prompt cheap.
 *   3. Calls Google Gemini (gemini-2.5-flash) with a system prompt that
 *      teaches the model the SPCC compliance domain + the JSON shape.
 *   4. Streams the response back to the client as Server-Sent Events.
 *
 * Why raw fetch instead of the @google/genai SDK: the SDK has Node/Deno
 * compatibility quirks under the Supabase edge runtime (some imports rely
 * on Node fs/streams shims). The REST API is small enough that calling it
 * directly is cleaner and avoids version drift.
 *
 * Setup notes (one-time, per CLAUDE.md migration policy):
 *   1. Get a key from https://aistudio.google.com/apikey
 *   2. In the Supabase dashboard → Edge Functions → Manage secrets, add
 *      GEMINI_API_KEY with that key.
 *   3. Deploy: `npx supabase functions deploy ai-assistant`
 *      (or via the dashboard's bulk deploy).
 *   4. The function requires NO migration — it only reads existing tables.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

/**
 * Allowlist of models the client is allowed to request. Anything outside
 * this list is rejected at the request boundary so a malicious client
 * can't bill us against an arbitrary upstream model.
 *
 * Keys are the client-facing IDs; values are what we pass to Gemini's
 * URL. Two layers of indirection means we can rename ids without breaking
 * stored preferences.
 */
// Client-facing id → upstream Gemini model name. Google's stable IDs as
// of May 2026:
//   * gemini-3.1-pro-preview (Pro tier; still on the -preview suffix)
//   * gemini-3.5-flash       (stable Flash — replaced gemini-3-flash-preview
//                              at I/O 2026 with Pro-level intelligence at
//                              Flash speed/price)
//   * gemini-3.1-flash-lite  (stable, cheapest)
// Earlier code paths used the bare "gemini-3.1-flash" string, which 404s
// against generateContent because no such SKU exists. The frontend
// button IDs (gemini-3.1-pro / gemini-3.1-flash) stay put — only the
// upstream resolution changes, so stored user prefs keep working.
//
// Thinking control: Gemini 3.5 replaced the integer `thinkingBudget`
// with a string enum `thinkingLevel` (minimal | low | medium | high).
// Sending the old field to 3.5 Flash silently returns no candidates —
// which surfaces in the UI as a "Thinking…" spinner that never
// resolves. We send `thinkingLevel` uniformly for all 3.x models.
type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
const ALLOWED_MODELS: Record<string, { upstream: string; thinkingLevel: ThinkingLevel }> = {
  'gemini-3.1-pro':        { upstream: 'gemini-3.1-pro-preview', thinkingLevel: 'high' },
  'gemini-3.1-flash':      { upstream: 'gemini-3.5-flash',       thinkingLevel: 'minimal' },
  'gemini-3.1-flash-lite': { upstream: 'gemini-3.1-flash-lite',  thinkingLevel: 'minimal' },
};
const DEFAULT_MODEL = 'gemini-3.1-flash';

function geminiEndpoint(upstream: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${upstream}:streamGenerateContent?alt=sse`;
}

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
  /** Optional client-side override. Must match ALLOWED_MODELS. */
  model?: string;
}

/**
 * Compact field abbreviations keep tokens down. The system prompt below
 * documents what each key means so the model can read the snapshot.
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
  // Hand-rolled join. We can't use the user_has_account_access RPC here
  // because that helper reads auth.uid() from the JWT context — and we're
  // calling it with the SERVICE ROLE client, where auth.uid() is null.
  // Disambiguate the embed: `account_users` has TWO foreign keys to `users`
  // (user_id and invited_by), so a bare `account_users(...)` embed returns
  // PGRST201 and `profile` ends up null — meaning every auth'd user got
  // bounced as "No access to this account". Pinning to the user_id FK
  // gives us the membership rows the access check actually cares about.
  const { data: profile } = await supabase
    .from('users')
    .select('id, is_agency_owner, email, account_users!account_users_user_id_fkey(account_id)')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (!profile) return false;
  if (profile.is_agency_owner) {
    // Agency owner: verify they own the agency that owns this account.
    const { data: acct } = await supabase
      .from('accounts')
      .select('agency_id, agencies!inner(owner_email)')
      .eq('id', accountId)
      .maybeSingle();
    if (!acct) return false;
    // @ts-expect-error nested join shape
    return profile.email === acct.agencies?.owner_email;
  }
  // Regular user: must have an account_users membership row for this account.
  const memberships = (profile.account_users ?? []) as Array<{ account_id: string }>;
  return memberships.some((m) => m.account_id === accountId);
}

/**
 * Convert our chat-style message array into Gemini's `contents` shape.
 * Gemini uses 'user' and 'model' (not 'assistant'). Empty/whitespace-only
 * messages would 400, so they're filtered out.
 */
function toGeminiContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    if (!GEMINI_API_KEY) {
      return jsonResponse({ error: 'GEMINI_API_KEY not configured. Set it in Supabase Edge Function secrets.' }, 500);
    }

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
      // Diagnostic enrichment: surface the signed-in email + the account
      // the request asked for. Lets the user (or me debugging on their
      // behalf) see at a glance whether the user is signed in as the
      // wrong identity vs. genuinely missing a membership row. Safe to
      // expose: the user already owns their own auth email.
      return jsonResponse({
        error: `No access to this account. You are signed in as ${user.email ?? '(unknown email)'} (auth id ${user.id}); the request asked for account ${body.accountId}.`,
      }, 403);
    }

    const snapshot = await loadSnapshot(body.accountId);
    const systemPrompt = buildSystemPrompt(snapshot);

    // Cap history at the last 12 turns. SPCC chats don't benefit from more
    // context, and the snapshot already dwarfs the conversation.
    const recentMessages = body.messages.slice(-12);
    const contents = toGeminiContents(recentMessages);

    // Resolve the model: client picks from ALLOWED_MODELS, otherwise default.
    // Pro reasons at 'high'; Flash variants run at 'minimal' for low latency.
    const requestedModel = body.model ?? DEFAULT_MODEL;
    const modelConfig = ALLOWED_MODELS[requestedModel] ?? ALLOWED_MODELS[DEFAULT_MODEL];

    // Diagnostic header — visible in Supabase function logs. Keeps the
    // bytes counts so we can tell at a glance whether a hang was on the
    // snapshot side or the Gemini side.
    console.log('[ai-assistant] req', JSON.stringify({
      account: body.accountId,
      requestedModel,
      upstream: modelConfig.upstream,
      thinkingLevel: modelConfig.thinkingLevel,
      facilityCount: snapshot.facilities.length,
      systemPromptBytes: systemPrompt.length,
      conversationTurns: recentMessages.length,
    }));

    // Call Gemini's streaming endpoint. SSE format: each event is a JSON
    // object with `candidates[0].content.parts[0].text` carrying the delta.
    const geminiResp = await fetch(geminiEndpoint(modelConfig.upstream), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          // Per ALLOWED_MODELS: Pro reasons at 'high', Flash variants
          // run at 'minimal' for low latency. NEVER send both
          // thinkingLevel + thinkingBudget — Gemini 3.5 returns 400.
          thinkingConfig: { thinkingLevel: modelConfig.thinkingLevel },
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });

    if (!geminiResp.ok || !geminiResp.body) {
      const errText = await geminiResp.text().catch(() => '');
      console.error('[ai-assistant] Gemini error:', geminiResp.status, errText);
      return jsonResponse({ error: `Gemini API ${geminiResp.status}: ${errText.slice(0, 500)}` }, 502);
    }

    // Re-emit the upstream SSE stream as our own SSE shape so the frontend
    // doesn't need to know which provider is behind the function.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        const reader = geminiResp.body!.getReader();
        let buffer = '';
        // Track whether we ever emitted text. If Gemini's stream closes
        // without producing any (e.g. blocked by safety, MAX_TOKENS
        // consumed by hidden thoughts, mis-configured thinking field
        // returning empty candidates), we surface a structured error
        // instead of letting the client sit on an empty placeholder
        // forever. Also collect the most recent finishReason for the
        // diagnostic.
        let emittedAnyText = false;
        let lastFinish: string | undefined;
        let totalChunks = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Gemini's SSE uses `data: {json}\n\n` delimiters.
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';

            for (const event of events) {
              const line = event.split('\n').find((l) => l.startsWith('data: '));
              if (!line) continue;
              totalChunks++;
              try {
                const json = JSON.parse(line.slice(6));
                const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  emittedAnyText = true;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`));
                }
                const finish: string | undefined = json?.candidates?.[0]?.finishReason;
                if (finish) lastFinish = finish;
                if (finish && finish !== 'STOP') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: `Stopped: ${finish}` })}\n\n`));
                }
              } catch (parseErr) {
                console.error('[ai-assistant] SSE parse error:', parseErr, line);
              }
            }
          }
          if (!emittedAnyText) {
            // The upstream stream closed cleanly but produced no text.
            // The most common cause once 3.5 landed was sending the
            // legacy `thinkingBudget` field, which yields empty
            // candidates with no error. Surface enough context so it's
            // obvious in the UI rather than spinning forever.
            const diag = `No text returned by ${modelConfig.upstream} (chunks: ${totalChunks}${lastFinish ? `, finish: ${lastFinish}` : ''}).`;
            console.error('[ai-assistant] empty stream:', diag);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: diag })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[ai-assistant] stream relay failed:', message);
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
        // NB: do NOT set `Connection: keep-alive` — it's a forbidden
        // hop-by-hop response header in the Fetch spec and some browsers
        // reject the entire response, surfacing as "Failed to fetch".
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ai-assistant]', message);
    return jsonResponse({ error: message }, 500);
  }
});
