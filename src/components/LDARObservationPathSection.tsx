import { useState } from 'react';
import { Navigation, Trash2 } from 'lucide-react';
import { supabase, type Facility } from '../lib/supabase';
import LDARObservationPathEditor from './LDARObservationPathEditor';
import LDARSourceSelector from './LDARSourceSelector';
import { useAuth } from '../contexts/AuthContext';

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
  // Access-gate: this section is agency-owner-only. Non-owners see
  // nothing (no header, no button) so the LDAR tab / SPCC plan modal
  // stay tidy for them. Hook is called unconditionally above the early
  // return to keep the hook order stable across re-renders.
  const { user } = useAuth();
  const [showEditor, setShowEditor] = useState(false);
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  // True when the editor should auto-fire AI generation as soon as it
  // loads the PDF. Set when the user clicks the "Generate..." button (vs.
  // the "Open Editor" button, which assumes a path already exists). Reset
  // when the editor closes so a subsequent re-open doesn't re-fire.
  const [editorAutoGenerate, setEditorAutoGenerate] = useState(false);
  const [deletingPath, setDeletingPath] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasLdarPdf = !!facility.ldar_site_plan_url;
  const hasSpccPdf = !!facility.spcc_plan_url;
  const canOpen = hasLdarPdf || hasSpccPdf;
  const stopCount = facility.ldar_observation_path_data?.stops?.length ?? 0;
  const hasExistingPath = stopCount > 0;

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

  const handleDeletePath = async () => {
    if (!hasExistingPath) return;
    const ok = window.confirm(
      `Delete the saved walking path for ${facility.name || 'this facility'}? ` +
        `This clears the ${stopCount} stop${stopCount === 1 ? '' : 's'}, the path shape, the legend, ` +
        `and the flattened PDF in the LDAR Site Plan section above (source PDF is kept). ` +
        `Generating again will start from scratch. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingPath(true);
    setError(null);
    try {
      // Also delete the baked / flattened PDF from storage so the LDAR
      // Site Plan section falls back to the source PDF (un-annotated).
      // Best-effort — a missing file or storage error isn't fatal to
      // clearing the JSON, but log it so we can debug.
      if (facility.ldar_observation_path_data?.annotated_pdf_url) {
        const { error: rmErr } = await supabase.storage
          .from('ldar-site-plans')
          .remove([`${facility.id}/site-plan-annotated.pdf`]);
        if (rmErr) console.warn('Could not remove annotated PDF from storage:', rmErr);
      }
      // NULL the JSONB. We deliberately leave ldar_observation_path_completed
      // alone — a user may have explicitly marked the path completed
      // (handled outside the system) and that flag is independent of
      // whether an in-app drawing exists.
      const patch = { ldar_observation_path_data: null };
      const { error: updateError } = await supabase
        .from('facilities')
        .update(patch)
        .eq('id', facility.id);
      if (updateError) throw updateError;
      Object.assign(facility, patch);
      onChange();
    } catch (err) {
      console.error('Failed to delete observation path:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setDeletingPath(false);
    }
  };

  // Agency-owner-only feature — render nothing for regular users / admins.
  // This must come AFTER all hook calls above to keep the hook order
  // consistent across renders (React's rules of hooks).
  if (!user?.isAgencyOwner) {
    return null;
  }

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
              {stopCount} stops
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

          {/* Destructive action — only surfaced when there's something to
              delete. Subtle text-link styling keeps it from competing with
              the primary actions. */}
          {hasExistingPath && (
            <button
              type="button"
              onClick={handleDeletePath}
              disabled={deletingPath}
              className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                darkMode
                  ? 'text-red-400/80 hover:text-red-300 hover:bg-red-900/20'
                  : 'text-red-600/80 hover:text-red-700 hover:bg-red-50'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Delete the saved walking path entirely (stops, shape, legend). Cannot be undone."
            >
              {deletingPath ? (
                <>
                  <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete saved path
                </>
              )}
            </button>
          )}

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
