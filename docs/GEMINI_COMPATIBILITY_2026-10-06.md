# Gemini request compatibility review — 2026-10-06

Base: `cd6b1abb844f9a604d71bcd3c52d08d48abd77b5`.

Both Google callers use v1beta REST generateContent in Supabase Edge Functions:

- `ai-assistant`: UI Pro maps to `gemini-3.1-pro-preview` / high;
  UI Flash maps to `gemini-3.5-flash` / minimal;
  UI Flash-Lite maps to `gemini-3.1-flash-lite` / minimal.
- `ldar-observation-path`: `gemini-3.1-pro-preview` / medium, JSON schema output.

They already send `thinkingConfig.thinkingLevel`, not `thinkingBudget`.
Remove only the custom temperatures (0.4 and 0.15), following Google's
[Gemini 3 sampling guidance](https://ai.google.dev/gemini-api/docs/generate-content/text-generation).
Keep models, levels, output caps, schema, prompts, safety settings and access
checks. Google's notice describes upcoming rejection; current documentation
still describes custom sampling as accepted but discouraged on Gemini 3.x.
No current outage or project attribution has been established.

`node --test tests/geminiParameters.test.mjs` runs the actual handler sources
with fake Supabase reads/auth and fake Google fetch. Six tests inspect every
selected upstream model, the unchanged LDAR schema, and denial before Google
for outsiders. No network, database or credentials are used. Vite build passes.

Release requires an approved deployment of **both** `ai-assistant` and
`ldar-observation-path` Edge Functions. A frontend deploy alone does not apply
this fix. There is no migration or secret change. No deployment was performed.
Live function versions and provider account access remain unverified.
