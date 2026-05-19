import { useAccount } from '../contexts/AccountContext';

/**
 * Returns the brand-aware label for the external facility-id field.
 *
 * Until late May 2026 the field was hardcoded as "Camino Facility ID"
 * throughout the UI — Camino was the only paying account using this
 * column. After Validus came on board, those labels leaked Camino's
 * name into the Validus view, which read as a multi-tenancy bug.
 *
 * The DB column itself is still named `camino_facility_id` (historical;
 * no plan to rename — it costs more in migrations and search-replace
 * than the cosmetic improvement is worth). Only the visible labels
 * switch.
 *
 * Returns:
 *   long  — "Camino Facility ID" / "Validus Facility ID" / "Facility ID"
 *           Used wherever a full label is shown (column headers, form
 *           labels, detail-modal field titles).
 *   short — "Camino ID" / "Validus ID" / "Facility ID"
 *           Used in compact contexts (search placeholder, secondary
 *           text). For accounts without a `company_name`, both fall
 *           back to "Facility ID" so the UI never reads as Camino-
 *           specific for a non-Camino tenant.
 */
export function useFacilityIdLabel(): { long: string; short: string } {
  const { currentAccount } = useAccount();
  const company = currentAccount?.company_name?.trim();
  if (!company) {
    return { long: 'Facility ID', short: 'Facility ID' };
  }
  return {
    long: `${company} Facility ID`,
    short: `${company} ID`,
  };
}
