import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Droplet, Check, AlertTriangle } from 'lucide-react';
import type { Facility, SPCCPlan } from '../lib/supabase';
import { getFacilityWells, getBermShortLabel, sortPlansByBermIndex, type FacilityWell } from '../utils/spccPlans';

/**
 * Two modes:
 *
 *  - mode="add-berm": adding a new berm. `newBermIndex` is the 1-based index
 *    for the berm being created. Shown after the user clicks "+ Add Berm" on
 *    the plan detail modal. Default assignment: every well stays on its
 *    current berm; the new berm starts empty. The user ticks wells over to
 *    the new berm.
 *
 *  - mode="reassign": no new berm; user is just rebalancing which wells are
 *    covered by which existing berm. Useful when they've mis-assigned at
 *    the original transition and want to fix it.
 *
 * On save we return a map of { wellIndex: bermIndex } covering EVERY well
 * the facility actually has. Wells are strictly single-assigned — this
 * matches the spec: "It has to be strict IF multiple berms are denoted."
 */

type Mode =
  | { kind: 'add-berm'; newBermIndex: number }
  | { kind: 'reassign' };

interface BermWellAssignmentModalProps {
  facility: Facility;
  existingPlans: SPCCPlan[];
  mode: Mode;
  darkMode: boolean;
  onSave: (args: {
    /** Map of wellIndex (1..6) → bermIndex the user assigned it to. */
    assignments: Record<number, number>;
    /** Only set when mode='add-berm'. */
    newBermIndex?: number;
  }) => Promise<void>;
  onClose: () => void;
}

export default function BermWellAssignmentModal({
  facility,
  existingPlans,
  mode,
  darkMode,
  onSave,
  onClose,
}: BermWellAssignmentModalProps) {
  const wells = useMemo<FacilityWell[]>(() => getFacilityWells(facility), [facility]);
  const sortedPlans = useMemo(() => sortPlansByBermIndex(existingPlans), [existingPlans]);

  // Berm indices to show as options in the radio group.
  const bermOptions = useMemo<number[]>(() => {
    const existing = sortedPlans.map((p) => p.berm_index);
    if (mode.kind === 'add-berm') {
      // Existing berms + the new one we're about to create
      return [...existing, mode.newBermIndex];
    }
    return existing;
  }, [sortedPlans, mode]);

  // Starting state: each well's current berm assignment (or the lowest berm
  // if orphaned — shouldn't happen in practice, but safe fallback).
  const initialAssignments = useMemo<Record<number, number>>(() => {
    const result: Record<number, number> = {};
    for (const w of wells) {
      const owningPlan = sortedPlans.find((p) => p.assigned_well_indices.includes(w.index));
      result[w.index] = owningPlan ? owningPlan.berm_index : (sortedPlans[0]?.berm_index ?? 1);
    }
    return result;
  }, [wells, sortedPlans]);

  const [assignments, setAssignments] = useState<Record<number, number>>(initialAssignments);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAssignment = (wellIndex: number, bermIndex: number) => {
    setAssignments((prev) => ({ ...prev, [wellIndex]: bermIndex }));
  };

  // Sanity: every well must be assigned to exactly one berm. Show a subtle
  // warning for any berm left without wells (legal, but worth flagging).
  const bermsWithNoWells = useMemo(() => {
    const covered = new Set(Object.values(assignments));
    return bermOptions.filter((idx) => !covered.has(idx));
  }, [assignments, bermOptions]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        assignments,
        newBermIndex: mode.kind === 'add-berm' ? mode.newBermIndex : undefined,
      });
      onClose();
    } catch (err: any) {
      console.error('Error saving berm well assignments:', err);
      setError(err?.message || 'Could not save assignments. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode.kind === 'add-berm'
      ? `Add Berm ${mode.newBermIndex} — Assign Wells`
      : 'Reassign Wells to Berms';

  const subtitle =
    mode.kind === 'add-berm'
      ? `Choose which wells are covered by each berm. Any well moved to Berm ${mode.newBermIndex} will be removed from its current berm.`
      : 'Each well can belong to exactly one berm. Move wells between berms as needed.';

  const bermLabelForOption = (bermIndex: number) => {
    const existing = sortedPlans.find((p) => p.berm_index === bermIndex);
    if (existing) return getBermShortLabel(existing);
    return `Berm ${bermIndex}`;
  };

  const content = (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-lg my-8 rounded-xl shadow-2xl overflow-hidden ${
          darkMode ? 'bg-gray-900' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={`flex items-start justify-between gap-3 px-5 py-4 border-b ${
            darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="min-w-0">
            <h2 className={`text-base font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
            <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-600'
            }`}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wells list */}
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {wells.length === 0 ? (
            <div
              className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                darkMode ? 'bg-amber-900/30 text-amber-200' : 'bg-amber-50 text-amber-700'
              }`}
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                This facility has no wells on file, so there are no wells to assign. You can still add
                a new berm — assignments can be made later once wells are added to the facility.
              </div>
            </div>
          ) : (
            wells.map((well) => (
              <div
                key={well.index}
                className={`rounded-lg border p-3 ${
                  darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Droplet className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {well.name}
                    </div>
                    {well.api && (
                      <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        API: {well.api}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {bermOptions.map((bermIndex) => {
                    const selected = assignments[well.index] === bermIndex;
                    return (
                      <button
                        key={bermIndex}
                        type="button"
                        onClick={() => setAssignment(well.index, bermIndex)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          selected
                            ? darkMode
                              ? 'bg-blue-900/40 border-blue-500 text-blue-200'
                              : 'bg-blue-50 border-blue-500 text-blue-700'
                            : darkMode
                              ? 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                              : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5" />}
                        {bermLabelForOption(bermIndex)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {bermsWithNoWells.length > 0 && (
            <div
              className={`flex items-start gap-2 rounded-lg p-3 text-xs ${
                darkMode ? 'bg-amber-900/30 text-amber-200' : 'bg-amber-50 text-amber-800'
              }`}
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                {bermsWithNoWells.length === 1 ? (
                  <>
                    <strong>{bermLabelForOption(bermsWithNoWells[0])}</strong> will have no wells
                    assigned. You can proceed and assign wells later.
                  </>
                ) : (
                  <>
                    {bermsWithNoWells.map(bermLabelForOption).join(', ')} will have no wells
                    assigned. You can proceed and assign wells later.
                  </>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div
          className={`flex justify-end gap-2 px-5 py-4 border-t ${
            darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              darkMode
                ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
            } disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
              saving ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {saving
              ? 'Saving…'
              : mode.kind === 'add-berm'
                ? `Add Berm ${mode.newBermIndex}`
                : 'Save Assignments'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
