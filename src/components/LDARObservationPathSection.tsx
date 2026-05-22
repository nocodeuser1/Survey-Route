import { useState } from 'react';
import { Navigation, CheckCircle } from 'lucide-react';
import { supabase, type Facility } from '../lib/supabase';
import LDARObservationPathEditor from './LDARObservationPathEditor';
import LDARSourceSelector from './LDARSourceSelector';

/**
 * "Observation Path" panel — companion to LDARSitePlanSection. Lets the
 * user generate (via AI), edit, or simply mark complete the LDAR
 * observation walking path for a facility.
 *
 * Self-contained: owns its own editor + source-selector modal state so
 * this section can be dropped anywhere LDARSitePlanSection appears
 * without the parent having to thread the editor mount through.
 *
 * Three actions:
 *   1. Big primary button — opens the editor (or, if no LDAR PDF yet
 *      but an SPCC plan is uploaded, the source-selector first to pull
 *      the Facility Site Plan page out of the SPCC PDF).
 *   2. "Mark Completed (no path needed)" toggle — for facilities whose
 *      walking path lives outside the system. Mirrors the
 *      ldar_site_plan_completed pattern.
 *   3. Disabled state — no LDAR PDF AND no SPCC plan uploaded; hint
 *      text tells the user what to upload.
 */

interface LDARObservationPathSectionProps {
  facility: Facility;
  darkMode: boolean;
  /** Called after any persisted change so the parent can refetch / re-render. */
  onChange: () => void;
}

export default function LDARObservationPathSection({
  facility,
  darkMode,
  onChange,
}: LDARObservationPathSectionProps) {
  const [showEditor, setShowEditor] = useState(false);
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  // True when the editor should auto-fire AI generation as soon as it
  // loads the PDF. Set when the user clicks the "Generate..." button (vs.
  // the "Open Editor" button, which assumes a path already exists). Reset
  // when the editor closes so a subsequent re-open doesn't re-fire.
  const [editorAutoGenerate, setEditorAutoGenerate] = useState(false);
  const [togglingCompleted, setTogglingCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasLdarPdf = !!facility.ldar_site_plan_url;
  const hasSpccPdf = !!facility.spcc_plan_url;
  const canOpen = hasLdarPdf || hasSpccPdf;
  const stopCount = facility.ldar_observation_path_data?.stops?.length ?? 0;
  const hasExistingPath = stopCount > 0;
  const isCompleted = !!facility.ldar_observation_path_completed;

  const buttonLabel = hasExistingPath
    ? 'Open Walking Path Editor'
    : hasLdarPdf
      ? 'Generate Walking Path with AI'
      : hasSpccPdf
        ? 'Use Site Plan from SPCC + Generate with AI'
        : 'Generate Walking Path with AI';

  const handleOpen = () => {
    // Only auto-generate when there's no existing path — pressing "Open
    // Editor" on an already-drawn path should open it for review, not
    // silently overwrite it.
    setEditorAutoGenerate(!hasExistingPath);
    if (hasLdarPdf) setShowEditor(true);
    else if (hasSpccPdf) setShowSourceSelector(true);
  };

  const handleToggleCompleted = async () => {
    setTogglingCompleted(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const completedBy = userData?.user?.id ?? null;
      const nowIso = new Date().toISOString();
      const patch = isCompleted
        ? {
            ldar_observation_path_completed: false,
            ldar_observation_path_completed_at: null,
            ldar_observation_path_completed_by: null,
          }
        : {
            ldar_observation_path_completed: true,
            ldar_observation_path_completed_at: nowIso,
            ldar_observation_path_completed_by: completedBy,
          };
      const { error: updateError } = await supabase
        .from('facilities')
        .update(patch)
        .eq('id', facility.id);
      if (updateError) throw updateError;
      // Mirror the updateFacilityField pattern used elsewhere — mutate the
      // prop in place so the parent's next render reflects the new state.
      Object.assign(facility, patch);
      onChange();
    } catch (err) {
      console.error('Failed to toggle observation path completion:', err);
      setError(err instanceof Error ? err.message : 'Failed to update.');
    } finally {
      setTogglingCompleted(false);
    }
  };

  return (
    <>
      <div
        className={`rounded-xl border ${
          darkMode ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'
        }`}
      >
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${
            darkMode ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Navigation className={`w-4 h-4 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
            <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              LDAR Observation Path
            </h3>
          </div>
          {hasExistingPath ? (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                darkMode ? 'bg-purple-900/30 text-purple-300' : 'bg-purple-100 text-purple-700'
              }`}
            >
              {stopCount} stops{isCompleted && ' · completed'}
            </span>
          ) : isCompleted ? (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                darkMode ? 'bg-green-900/30 text-green-300' : 'bg-green-100 text-green-700'
              }`}
            >
              <CheckCircle className="w-3 h-3" />
              Completed
            </span>
          ) : (
            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Not drawn</span>
          )}
        </div>
        <div className="px-4 py-3 space-y-3">
          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Numbered walking path drawn on top of the LDAR site plan. The AI proposes the
            route based on the labeled equipment; you can drag, edit numbers, and adjust
            the legend before saving.
          </p>

          <button
            type="button"
            onClick={handleOpen}
            disabled={!canOpen}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm text-white transition-colors ${
              !canOpen
                ? 'bg-purple-600/40 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
            }`}
            title={
              hasLdarPdf
                ? 'Open the walking-path editor'
                : hasSpccPdf
                  ? 'Extract the Facility Site Plan page from the SPCC plan and open the editor'
                  : 'Upload an LDAR site plan PDF or an SPCC plan first'
            }
          >
            {buttonLabel}
          </button>

          {!canOpen && (
            <p className={`text-xs italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              Upload an LDAR site plan PDF above, or upload an SPCC plan, to enable the
              walking-path editor.
            </p>
          )}
          {!hasLdarPdf && hasSpccPdf && !hasExistingPath && (
            <p className={`text-xs italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              No separate LDAR site plan uploaded — we'll pull the Facility Site Plan
              figure out of your SPCC plan automatically.
            </p>
          )}

          {/* "or" divider + mark-complete toggle. For facilities whose
              observation path lives outside the system. */}
          <div className="flex items-center gap-2 pt-1">
            <div className={`flex-1 h-px ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />
            <span className={`text-[10px] uppercase tracking-wider ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>or</span>
            <div className={`flex-1 h-px ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />
          </div>

          <button
            type="button"
            onClick={handleToggleCompleted}
            disabled={togglingCompleted}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isCompleted
                ? darkMode
                  ? 'border border-green-800/60 bg-green-900/20 hover:bg-green-900/30 text-green-300'
                  : 'border border-green-300 bg-green-50 hover:bg-green-100 text-green-700'
                : darkMode
                  ? 'border border-gray-700 bg-gray-900/40 hover:bg-gray-800 text-gray-200'
                  : 'border border-gray-300 bg-white hover:bg-gray-50 text-gray-700'
            } disabled:opacity-60 disabled:cursor-not-allowed`}
            title={
              isCompleted
                ? 'Un-mark the observation path as completed'
                : 'Mark the observation path completed without drawing one (e.g. when the client has the document)'
            }
          >
            {togglingCompleted ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Updating…
              </>
            ) : isCompleted ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Completed — click to un-mark
              </>
            ) : (
              <>Mark as Completed (no path needed)</>
            )}
          </button>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
        </div>
      </div>

      {/* Modals — rendered inside this section so any parent can embed
          LDARObservationPathSection without wiring up modal state. */}
      {showEditor && (
        <LDARObservationPathEditor
          facility={facility}
          darkMode={darkMode}
          autoGenerate={editorAutoGenerate}
          onClose={() => {
            setShowEditor(false);
            setEditorAutoGenerate(false);
          }}
          onSaved={onChange}
        />
      )}
      {showSourceSelector && (
        <LDARSourceSelector
          facility={facility}
          darkMode={darkMode}
          onClose={() => setShowSourceSelector(false)}
          onConfirmed={() => {
            setShowSourceSelector(false);
            onChange();
            // Chain straight into the editor — the user already confirmed
            // the source page, so making them click another button to
            // open the editor would be friction.
            setShowEditor(true);
          }}
        />
      )}
    </>
  );
}
