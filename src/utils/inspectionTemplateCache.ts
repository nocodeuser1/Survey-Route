import { supabase, InspectionTemplate } from '../lib/supabase';

// The inspection form used to wait on this query every time it opened, which
// on a slow or stalled mobile connection meant up to a minute of spinner. The
// template rarely changes, so keep the last good copy on the device, open the
// form from it immediately, and refresh it in the background.
const TEMPLATE_NAME = 'SPCC Inspection';
const cacheKey = (scope: string) => `survey-route:inspection-template:v1:${scope}`;
const inFlight = new Map<string, Promise<InspectionTemplate>>();

function isUsable(template: unknown): template is InspectionTemplate {
  const questions = (template as InspectionTemplate | null)?.questions;
  return Array.isArray(questions) && questions.length > 0;
}

export function readCachedInspectionTemplate(scope: string): InspectionTemplate | null {
  try {
    const raw = localStorage.getItem(cacheKey(scope));
    const parsed = raw ? JSON.parse(raw) : null;
    return isUsable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fetches the template once per app session per scope (concurrent callers
 * share the request) and refreshes the device copy. Rejects with a message
 * that can be shown to the user as-is.
 */
export function fetchInspectionTemplate(scope: string): Promise<InspectionTemplate> {
  const pending = inFlight.get(scope);
  if (pending) return pending;

  const request = (async () => {
    const { data, error } = await supabase
      .from('inspection_templates')
      .select('*')
      .eq('name', TEMPLATE_NAME)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error: ${error.message}. Please check your internet connection and try again.`);
    }
    if (!data) {
      throw new Error('Inspection template not found in database. Please contact your administrator to set up the inspection template.');
    }
    if (!isUsable(data)) {
      throw new Error('Inspection template is empty or corrupted. Please contact your administrator.');
    }
    try {
      localStorage.setItem(cacheKey(scope), JSON.stringify(data));
    } catch {
      // Storage full or unavailable; the form still has the fresh copy.
    }
    return data;
  })();

  inFlight.set(scope, request);
  // A failed request must not stick for the rest of the session.
  request.catch(() => inFlight.delete(scope));
  return request;
}

/** Warm the cache before the user taps Inspect. Errors are left to the form. */
export function prefetchInspectionTemplate(scope: string) {
  if (!scope) return;
  fetchInspectionTemplate(scope).catch(() => {});
}
