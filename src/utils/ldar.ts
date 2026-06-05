/**
 * LDAR Site Plan applicability + status helpers.
 *
 * Regulatory background: a facility needs an LDAR Site Plan if it
 * "commenced construction" after Dec 6, 2022. We don't track a
 * commenced-construction date, so we PROXY it with the Initial Production
 * (IP) date (`first_prod_date`). That's an approximation — a facility's IP
 * date is later than when construction began — so this flags a superset is
 * possible, but in practice IP date is the closest signal we have. Any UI
 * that surfaces "Needed" should carry that caveat (see the note strings
 * below) so the user knows it's an IP-date proxy, not the literal rule.
 */

import type { Facility } from '../lib/supabase';
import { parseLocalDate } from './dateUtils';

/** Cutoff for LDAR Site Plan applicability (commenced-construction rule,
 *  proxied by IP date). Facilities with an IP date strictly after this need
 *  a plan. */
export const LDAR_CUTOFF_ISO = '2022-12-06';

/** Human-friendly cutoff for labels/tooltips. */
export const LDAR_CUTOFF_LABEL = '12/6/2022';

/** Shared caveat shown in tooltips so users know "Needed" is derived from
 *  the IP date, not the literal "commenced construction" date. */
export const LDAR_PROXY_NOTE =
  `LDAR Site Plans are required for facilities that commenced construction after ${LDAR_CUTOFF_LABEL}. ` +
  `That date isn't tracked, so this uses the Initial Production (IP) date as a proxy — verify against the actual construction date before relying on it.`;

export type LdarSitePlanState = 'completed' | 'uploaded' | 'needed' | 'not_required';

type LdarFacilityFields = Pick<
  Facility,
  'first_prod_date' | 'ldar_site_plan_completed' | 'ldar_site_plan_url'
>;

/** True when the facility's IP date is strictly after the LDAR cutoff (our
 *  proxy for "commenced construction after the cutoff"). Facilities with no
 *  IP date can't be assessed and return false. */
export function isLdarSitePlanRequired(
  facility: Pick<Facility, 'first_prod_date'>,
): boolean {
  if (!facility.first_prod_date) return false;
  const ip = parseLocalDate(facility.first_prod_date).getTime();
  const cutoff = parseLocalDate(LDAR_CUTOFF_ISO).getTime();
  return ip > cutoff;
}

/**
 * Resolve a facility's LDAR Site Plan state:
 *  - 'completed'    — marked complete (work done, with or without a file)
 *  - 'uploaded'     — a file is on record but it's not marked complete yet
 *  - 'needed'       — required (IP after cutoff) and no plan on file
 *  - 'not_required' — IP on/before the cutoff (or no IP date) and no plan
 */
export function getLdarSitePlanState(
  facility: LdarFacilityFields,
): LdarSitePlanState {
  if (facility.ldar_site_plan_completed) return 'completed';
  if (facility.ldar_site_plan_url) return 'uploaded';
  if (isLdarSitePlanRequired(facility)) return 'needed';
  return 'not_required';
}
