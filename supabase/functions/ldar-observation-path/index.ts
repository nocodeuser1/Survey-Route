/**
 * LDAR Observation Path — Supabase Edge Function (Gemini Vision)
 *
 * Backs the "Generate with AI" button in the LDAR Observation Path editor.
 * The frontend POSTs a base64-encoded image of page 1 of the LDAR site plan
 * PDF + the facility id; this function:
 *
 *   1. Verifies the user's JWT + their access to the facility's account
 *      (reuses the verifyAccountAccess pattern from ai-assistant).
 *   2. Calls Google Gemini Vision (gemini-3.1-pro-preview) with a strict
 *      JSON-output prompt that encodes the walking-path rules.
 *   3. Validates the model's JSON shape and returns it to the client.
 *
 * Why Pro Preview, not Flash: this is a one-shot spatial-reasoning task that
 * has to read aerial-photo callouts AND place coordinates at equipment
 * centroids. Pro's vision accuracy + 'high' thinking level is worth the
 * extra latency (a few seconds, not interactive). The frontend shows a
 * "thinking…" state during the call.
 *
 * Setup notes:
 *   1. GEMINI_API_KEY is already configured in Supabase Edge Function secrets
 *      (shared with ai-assistant). No extra setup needed.
 *   2. Deploy: `npx supabase functions deploy ldar-observation-path`
 *   3. The function requires NO migration of its own — it only reads
 *      facilities.account_id for the access check.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

// Mirrors the ai-assistant function's model resolution. Pro Preview is the
// vision-quality leader; Flash is too quick to reason about spatial layout
// reliably for this task.
const UPSTREAM_MODEL = 'gemini-3.1-pro-preview';
// thinkingLevel tokens count against maxOutputTokens. At 'high', Pro was
// burning ~3000+ tokens on reasoning and getting truncated mid-JSON with
// finishReason MAX_TOKENS. 'medium' gives ample reasoning headroom for a
// visual-layout task while leaving room for the full JSON output.
const THINKING_LEVEL = 'medium';

function geminiEndpoint(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${UPSTREAM_MODEL}:generateContent`;
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

interface RequestBody {
  facilityId: string;
  /** Data URL or raw base64 of a PNG/JPEG of page 1 of the LDAR site plan. */
  imageBase64: string;
  /** MIME type of the image. Defaults to 'image/png'. */
  imageMimeType?: 'image/png' | 'image/jpeg';
}

/**
 * Verifies the caller has access to the facility's parent account. Mirrors
 * the agency-owner + member pattern from ai-assistant.
 */
async function verifyFacilityAccess(authUserId: string, facilityId: string): Promise<boolean> {
  const { data: facility, error: facErr } = await supabase
    .from('facilities')
    .select('account_id')
    .eq('id', facilityId)
    .maybeSingle();
  if (facErr || !facility?.account_id) return false;
  const accountId = facility.account_id;

  // Same join shape as ai-assistant's verifyAccountAccess. Pinning the FK
  // because account_users has two foreign keys to users (user_id +
  // invited_by) and the bare embed otherwise returns PGRST201.
  const { data: profile } = await supabase
    .from('users')
    .select('id, is_agency_owner, email, account_users!account_users_user_id_fkey(account_id)')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (!profile) return false;

  if (profile.is_agency_owner) {
    const { data: acct } = await supabase
      .from('accounts')
      .select('agency_id, agencies!inner(owner_email)')
      .eq('id', accountId)
      .maybeSingle();
    if (!acct) return false;
    // @ts-expect-error nested join shape
    return profile.email === acct.agencies?.owner_email;
  }

  const memberships = (profile.account_users ?? []) as Array<{ account_id: string }>;
  return memberships.some((m) => m.account_id === accountId);
}

/**
 * Strip the data: URL prefix if present, leaving just the base64 payload.
 * Gemini's inlineData.data field wants raw base64, not a data URL.
 */
function stripDataUrl(input: string): string {
  const comma = input.indexOf(',');
  if (input.startsWith('data:') && comma > 0) return input.slice(comma + 1);
  return input;
}

const SYSTEM_PROMPT = `You are an LDAR (Leak Detection And Repair) observation-path planner. You analyze aerial site plan images of oil & gas facilities and produce a numbered walking route for an inspector to follow, plus the legend that goes with it.

# Input
A top-down aerial photo of a wellsite/tank battery, with yellow callout boxes that label each piece of equipment (e.g. "Wellheads", "Sales Gas", "Separators", "Combustor", "VRU", "Heater Treaters", "Crude Oil Storage Tanks", "Produced Water Storage Tanks", "Methanol Tank", "Gas Cooler", "Compressor", "Thief Hatches", "Dump Valves", "Tank Piping").

# Walking-order rules (ABSOLUTE — do not deviate)
1. The FIRST stop (number 1) is always at the wellhead(s). Wellheads are on the wellpad surface — find the callout that says "Well Head" / "Wellhead" / "Wellheads (Nx)".
2. The SECOND stop (number 2) must be the piece of equipment that is FARTHEST from the combustor/flare. On a typical layout this is the sales-gas line or another upstream component on the far side of the facility from the combustor. Pick by visual distance from the combustor callout.
3. From stop 2, walk TOWARD the combustor/flare, visiting every labeled piece of equipment in succession. Choose the natural order along the production train (sales-gas → gas-cooler / compressor → separators → heater-treaters → tanks → VRU → combustor). The path moves geographically across the facility — it does NOT zig-zag back and forth.
4. The LAST stop (number N) is the combustor/flare (or whichever destructive-emission device is present).
5. If multiple identical units exist (e.g. "4x Separators", "2x Heater Treaters", "6x Crude Oil Storage Tanks"), they are ONE stop, not many. Place the circle on the cluster centroid and use the labeled count in the legend text (e.g. "Separators (4x)").
6. Tank thief hatches, dump valves, and tank piping are observed together as ONE stop, NOT separate stops. Use the legend wording: "View Thief Hatches, Dump Valves, and Tank Piping (for Crude Oil Storage Tanks and Produced Water Storage Tank)" — match the exact tank names visible in the photo.
7. Methanol tanks and corrosion-inhibitor tanks are observed implicitly while walking past — DO NOT add separate stops for them unless they are clearly isolated from the production train.
8. Numbers are sequential 1..N with no gaps and no duplicates.

# Coordinate system
- All x and y values are NORMALIZED 0..1 to the source image.
- (0, 0) is the top-left corner of the image. (1, 1) is the bottom-right corner.

# Stop placement (CRITICAL — this is a common failure mode)
- Each stop is drawn as a ~3%-of-image-height red circle with a white number inside. Its (x, y) is the circle's CENTER.
- Place each circle in **empty ground space ADJACENT to the equipment**, NOT directly on top of the equipment, and NEVER overlapping the yellow label callout boxes.
- Preferred placement order, in order of preference:
    1. SLIGHTLY ABOVE the equipment, in empty ground area, close enough that it's visually associated with the equipment but offset by roughly 4–8% of image height so the circle does not touch the equipment.
    2. To one side (left or right) in empty ground, if there's no clear space above.
    3. Below the equipment.
    4. Only as a last resort, on the equipment itself — and only on a part of it that isn't critical to read.
- Never overlap two circles with each other.
- Never overlap the yellow label callout boxes. The labels are how a reader identifies the equipment; covering one is worse than covering the equipment.
- The wellhead stop (stop 1) is typically placed in the empty wellpad area ABOVE the wellheads, not on top of the wellhead frames themselves.

# Walking path waypoints (per-segment)
- Each waypoint MUST include an integer \`afterStop\` field. \`afterStop: 3\` means this waypoint shapes the path between stop 3 and stop 4.
- Waypoints with \`afterStop: N\` MUST lie geographically BETWEEN stop N and stop N+1. Do NOT put a waypoint near the bottom-left when its afterStop is 1→2 in the upper-right — that would make the path wrap around.
- Provide 0–3 waypoints per segment, only where the path actually needs to bend around tanks / fences / equipment. Short straight segments need none.
- The smoothed curve will pass through: stop1 → (afterStop=1 waypoints in array order) → stop2 → (afterStop=2 waypoints) → stop3 → ... → stopN.

# Legend placement (CRITICAL — survey this corner of the image before placing)
The legend is the small box that lists each numbered stop. It goes in EMPTY GROUND in a BOTTOM CORNER of the image.

Before choosing a corner, look at BOTH bottom corners and identify which one has more empty space. The legend MUST NOT cover ANY of these:
  - The NORTH ARROW / compass rose (the small "↑N" or "N↑" symbol — often a square cartouche in a corner). Very common in bottom-LEFT.
  - The TITLE BLOCK (the bordered box at the bottom of the figure with "FACILITY SITE PLAN", "DATE:", "FIGURE NO.:", etc.). Often spans the full bottom edge.
  - The FLOW DIRECTION arrow (a red arrow with "Flow Direction" text, often in the upper half — usually fine, but check).
  - Any equipment or yellow callout label.

Rules for picking which corner:
  - If the north arrow is at bottom-LEFT → place the legend at bottom-RIGHT.
  - If the north arrow is at bottom-RIGHT → place the legend at bottom-LEFT.
  - If both bottom corners have artifacts, place the legend in the upper corner that has the most empty space (still avoiding equipment).

Sizing (the renderer auto-grows height to fit wrapped text, so err small):
  - Width 0.28–0.42. Tight to content.
  - Height 0.12–0.20 — provide an honest estimate; the renderer will grow taller if items wrap, so DO NOT over-size by guessing huge.
  - The renderer will also cap the font sizes regardless of width, so don't try to compensate for a too-large legend by giving wide bounds.

# Output (STRICT JSON, no markdown, no commentary, no surrounding prose)
Return EXACTLY this shape:
{
  "stops": [
    { "number": 1, "x": 0.55, "y": 0.65, "label": "Wellheads (2x)" },
    { "number": 2, "x": 0.06, "y": 0.18, "label": "Sales Gas" }
    // ... one entry per stop, ending with the combustor
  ],
  "waypoints": [
    { "afterStop": 1, "x": 0.40, "y": 0.55 },  // shapes the segment between stops 1 and 2
    { "afterStop": 1, "x": 0.20, "y": 0.40 },  // also between stops 1 and 2
    { "afterStop": 3, "x": 0.55, "y": 0.62 }   // shapes the segment between stops 3 and 4
    // ... 0..3 per segment, only where the path needs to bend
  ],
  "legend": {
    "x": 0.04, "y": 0.85, "w": 0.46, "h": 0.13,
    "title": "LDAR OBSERVATION PATH"
  }
}`;

interface ValidatedPath {
  stops: Array<{ number: number; x: number; y: number; label: string }>;
  waypoints: Array<{ x: number; y: number; afterStop: number }>;
  legend: { x: number; y: number; w: number; h: number; title?: string };
}

/**
 * Validate the model's output. We don't trust an LLM's JSON to be perfectly
 * shaped, so this clamps coords to 0..1, drops malformed entries, and bails
 * with a clear error if the core structure is missing.
 */
function validatePath(raw: unknown): ValidatedPath {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Model returned non-object');
  }
  const r = raw as Record<string, unknown>;
  const stopsIn = Array.isArray(r.stops) ? r.stops : [];
  const wpsIn = Array.isArray(r.waypoints) ? r.waypoints : [];
  const legIn = (r.legend as Record<string, unknown>) ?? {};

  const clamp01 = (n: unknown, fallback: number): number => {
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(1, v));
  };

  const stops = (stopsIn as Array<Record<string, unknown>>)
    .map((s, i) => ({
      number: typeof s.number === 'number' ? Math.round(s.number) : i + 1,
      x: clamp01(s.x, 0.5),
      y: clamp01(s.y, 0.5),
      label: typeof s.label === 'string' ? s.label.trim() : `Stop ${i + 1}`,
    }))
    .filter((s) => s.label.length > 0);

  if (stops.length < 2) {
    throw new Error(`Model returned only ${stops.length} stops; expected at least 2 (start + combustor).`);
  }

  // Default afterStop = first stop's number — matches the legacy "all
  // waypoints between stops 1 and 2" rendering if the model somehow
  // omits the field. Validate it's actually an existing stop number, else
  // fall back to the first stop so a stray value can't create an
  // orphaned segment.
  const firstStopNumber = stops[0].number;
  const validStopNumbers = new Set(stops.map((s) => s.number));
  const waypoints = (wpsIn as Array<Record<string, unknown>>)
    .map((w) => {
      const rawAfter = typeof w.afterStop === 'number' ? Math.round(w.afterStop) : firstStopNumber;
      const afterStop = validStopNumbers.has(rawAfter) ? rawAfter : firstStopNumber;
      return {
        x: clamp01(w.x, 0.5),
        y: clamp01(w.y, 0.5),
        afterStop,
      };
    });

  const legend = {
    x: clamp01(legIn.x, 0.04),
    y: clamp01(legIn.y, 0.82),
    w: Math.max(0.15, clamp01(legIn.w, 0.4)),
    h: Math.max(0.05, clamp01(legIn.h, 0.15)),
    title: typeof legIn.title === 'string' ? legIn.title : 'LDAR OBSERVATION PATH',
  };

  return { stops, waypoints, legend };
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
      return jsonResponse(
        { error: 'GEMINI_API_KEY not configured. Set it in Supabase Edge Function secrets.' },
        500,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return jsonResponse({ error: 'Invalid token' }, 401);

    const body = (await req.json()) as RequestBody;
    if (!body.facilityId || typeof body.facilityId !== 'string') {
      return jsonResponse({ error: 'facilityId required' }, 400);
    }
    if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
      return jsonResponse({ error: 'imageBase64 required' }, 400);
    }

    const hasAccess = await verifyFacilityAccess(user.id, body.facilityId);
    if (!hasAccess) {
      return jsonResponse(
        {
          error: `No access to this facility. You are signed in as ${user.email ?? '(unknown email)'} (auth id ${user.id}); the request asked for facility ${body.facilityId}.`,
        },
        403,
      );
    }

    const rawBase64 = stripDataUrl(body.imageBase64);
    const mime = body.imageMimeType ?? 'image/png';

    // Sanity-check the image size. Gemini's inline limit is ~7MB; we render
    // at 2x so a typical LDAR page is well under 1MB. Reject anything wildly
    // outside that range so we fail fast.
    const approxBinaryBytes = Math.floor((rawBase64.length * 3) / 4);
    if (approxBinaryBytes > 10 * 1024 * 1024) {
      return jsonResponse(
        { error: `Image too large (~${(approxBinaryBytes / 1024 / 1024).toFixed(1)} MB). Reduce render scale.` },
        413,
      );
    }

    console.log('[ldar-observation-path] req', JSON.stringify({
      facility: body.facilityId,
      upstream: UPSTREAM_MODEL,
      imageBytes: approxBinaryBytes,
      mime,
    }));

    const geminiResp = await fetch(geminiEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: mime, data: rawBase64 } },
              { text: 'Generate the observation path for this LDAR site plan. Return JSON only.' },
            ],
          },
        ],
        generationConfig: {
          // Low temperature: the rules are deterministic; we don't want
          // creativity, just adherence to the spec.
          temperature: 0.15,
          // 2048 → 4096 wasn't enough: even with thinkingLevel dropped to
          // 'medium', Pro still produces ~500-1500 thinking tokens before
          // a large structured-JSON output. The first real attempt at
          // 4096 hit MAX_TOKENS mid-stream after two stops. 8192 gives
          // headroom for 10+ stops + waypoints + legend + reasoning
          // without paying real money (the call is one-shot).
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          // Strict schema — Gemini's structured-output mode constrains
          // the model to emit JSON matching this exact shape. Without a
          // schema, even with responseMimeType set, Pro sometimes wraps
          // output in markdown fences or prepends reasoning prose.
          responseSchema: {
            type: 'object',
            properties: {
              stops: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    number: { type: 'integer' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    label: { type: 'string' },
                  },
                  required: ['number', 'x', 'y', 'label'],
                  propertyOrdering: ['number', 'x', 'y', 'label'],
                },
              },
              waypoints: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    afterStop: { type: 'integer' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                  required: ['afterStop', 'x', 'y'],
                  propertyOrdering: ['afterStop', 'x', 'y'],
                },
              },
              legend: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  w: { type: 'number' },
                  h: { type: 'number' },
                  title: { type: 'string' },
                },
                required: ['x', 'y', 'w', 'h'],
                propertyOrdering: ['x', 'y', 'w', 'h', 'title'],
              },
            },
            required: ['stops', 'waypoints', 'legend'],
            propertyOrdering: ['stops', 'waypoints', 'legend'],
          },
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text().catch(() => '');
      console.error('[ldar-observation-path] Gemini error:', geminiResp.status, errText);
      return jsonResponse({ error: `Gemini API ${geminiResp.status}: ${errText.slice(0, 500)}` }, 502);
    }

    const geminiJson = await geminiResp.json().catch((err) => {
      console.error('[ldar-observation-path] failed to parse Gemini JSON:', err);
      return null;
    });

    const candidate = geminiJson?.candidates?.[0];
    const parts: Array<{ text?: string }> = candidate?.content?.parts ?? [];
    const fullText = parts.map((p) => p.text ?? '').join('').trim();
    const finishReason: string | undefined = candidate?.finishReason;
    const promptFeedback = geminiJson?.promptFeedback;

    if (!fullText) {
      const detail = promptFeedback?.blockReason
        ? `Blocked by safety filter: ${promptFeedback.blockReason}`
        : finishReason === 'MAX_TOKENS'
          ? `Model ran out of output tokens before finishing the path. Try again (maxOutputTokens may need a bump).`
          : finishReason && finishReason !== 'STOP'
            ? `Stopped: ${finishReason}`
            : `Empty response from ${UPSTREAM_MODEL}`;
      console.error('[ldar-observation-path] empty response:', detail);
      return jsonResponse({ error: detail }, 502);
    }

    // Defensive parse: even with responseSchema + responseMimeType set,
    // Pro occasionally still emits markdown code fences around the JSON
    // when thinkingLevel is 'high'. Strip them before parsing.
    const cleaned = fullText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error('[ldar-observation-path] JSON parse failed:', err, cleaned.slice(0, 300));
      // Surface a short prefix of what the model actually returned so the
      // user (or me, debugging) can see what went wrong without digging
      // through edge-function logs.
      return jsonResponse({
        error: `Model returned non-JSON output (finishReason: ${finishReason ?? 'unknown'}). First 200 chars: ${cleaned.slice(0, 200)}`,
      }, 502);
    }

    let validated: ValidatedPath;
    try {
      validated = validatePath(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'validation failed';
      console.error('[ldar-observation-path] validation failed:', msg, cleaned.slice(0, 300));
      return jsonResponse({ error: msg }, 502);
    }

    console.log('[ldar-observation-path] ok', JSON.stringify({
      stops: validated.stops.length,
      waypoints: validated.waypoints.length,
      finishReason,
    }));

    return jsonResponse({
      ...validated,
      model: UPSTREAM_MODEL,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ldar-observation-path]', message);
    return jsonResponse({ error: message }, 500);
  }
});
