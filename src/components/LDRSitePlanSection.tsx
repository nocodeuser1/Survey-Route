import { useState } from 'react';
import { CheckCircle2, FileText, ExternalLink, RefreshCcw, Circle, Loader2 } from 'lucide-react';
import { supabase, type Facility } from '../lib/supabase';
import { formatDate } from '../utils/dateUtils';
import InlineLDRSitePlanUpload from './InlineLDRSitePlanUpload';

/**
 * "LDR Site Plan" panel — facility-level completion tracking + optional file
 * upload. Lives alongside the SPCC plan UI but is intentionally independent:
 * marking the LDR side complete does NOT touch any spcc_* column.
 *
 * Two interaction paths:
 *   1. **Upload a file.** Drops/picks a PDF → uses InlineLDRSitePlanUpload
 *      (the tested-and-true fork of InlineSPCCPlanUpload) → file lands in
 *      `ldr-site-plans` bucket, facility row gets the URL + filename, and
 *      ldr_site_plan_completed is auto-set to true.
 *   2. **Mark completed without a file.** Clicks the "Mark as Completed"
 *      toggle. Sets ldr_site_plan_completed=true with no file. Israel
 *      explicitly called out that an upload is optional ("some completed
 *      that will not be uploaded").
 *
 * The toggle can also un-complete the LDR (e.g. if it was marked by mistake).
 * Un-completing does NOT delete the uploaded file, on the assumption that
 * the user will likely re-complete shortly; the file is still accessible
 * via the stored URL.
 */

interface LDRSitePlanSectionProps {
  facility: Facility;
  darkMode: boolean;
  onChange: () => void;
}

export default function LDRSitePlanSection({ facility, darkMode, onChange }: LDRSitePlanSectionProps) {
  const [isToggling, setIsToggling] = useState(false);
  const [showReupload, setShowReupload] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCompleted = !!facility.ldr_site_plan_completed;
  const hasFile = !!facility.ldr_site_plan_url;

  const handleToggleCompleted = async () => {
    setIsToggling(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const completedBy = userData?.user?.id ?? null;
      const nowIso = new Date().toISOString();

      if (isCompleted) {
        // Un-complete. Keep the file URL intact (user may re-complete soon).
        const patch = {
          ldr_site_plan_completed: false,
          ldr_site_plan_completed_at: null,
          ldr_site_plan_completed_by: null,
        };
        const { error: updateError } = await supabase
          .from('facilities')
          .update(patch)
          .eq('id', facility.id);
        if (updateError) throw updateError;
        // Mutate the prop in place so the parent's re-render reflects the new
        // state immediately. Mirrors the updateFacilityField pattern used in
        // FacilityDetailModal.
        Object.assign(facility, patch);
      } else {
        const patch = {
          ldr_site_plan_completed: true,
          ldr_site_plan_completed_at: nowIso,
          ldr_site_plan_completed_by: completedBy,
        };
        const { error: updateError } = await supabase
          .from('facilities')
          .update(patch)
          .eq('id', facility.id);
        if (updateError) throw updateError;
        Object.assign(facility, patch);
      }
      onChange();
    } catch (err: any) {
      console.error('Error toggling LDR completion:', err);
      setError(err.message || 'Failed to update LDR status');
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div
      className={`rounded-xl border ${
        darkMode ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <FileText className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
          <h3 className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            LDR Site Plan
          </h3>
        </div>
        {isCompleted ? (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              darkMode ? 'bg-green-900/30 text-green-300' : 'bg-green-100 text-green-700'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            Completed
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
            }`}
          >
            <Circle className="w-3 h-3" />
            Not completed
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Toggle row */}
        <button
          type="button"
          onClick={handleToggleCompleted}
          disabled={isToggling}
          className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${
            isCompleted
              ? darkMode
                ? 'border-green-700/50 bg-green-900/10 hover:bg-green-900/20'
                : 'border-green-300 bg-green-50 hover:bg-green-100'
              : darkMode
                ? 'border-gray-700 bg-gray-900/40 hover:bg-gray-800'
                : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
          } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <div className="flex items-center gap-3 text-left">
            {isToggling ? (
              <Loader2 className={`w-5 h-5 animate-spin ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
            ) : isCompleted ? (
              <CheckCircle2 className={`w-5 h-5 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
            ) : (
              <Circle className={`w-5 h-5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            )}
            <div>
              <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {isCompleted ? 'Site Plan Completed' : 'Mark Site Plan as Completed'}
              </p>
              {isCompleted && facility.ldr_site_plan_completed_at ? (
                <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Completed {formatDate(facility.ldr_site_plan_completed_at)}
                </p>
              ) : (
                <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Upload below, or click here to mark complete without a file.
                </p>
              )}
            </div>
          </div>
          {isCompleted && (
            <span
              className={`text-xs font-medium px-2 py-1 rounded ${
                darkMode ? 'bg-gray-700 text-gray-300' : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              Un-mark
            </span>
          )}
        </button>

        {/* File row — uploaded file display OR upload zone */}
        {hasFile && !showReupload ? (
          <div
            className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${
              darkMode ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`p-2 rounded ${darkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <a
                  href={facility.ldr_site_plan_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-sm font-medium hover:underline inline-flex items-center gap-1 truncate ${
                    darkMode ? 'text-blue-300' : 'text-blue-700'
                  }`}
                >
                  <span className="truncate">{facility.ldr_site_plan_filename || 'Site Plan.pdf'}</span>
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
                {facility.ldr_site_plan_uploaded_at && (
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Uploaded {formatDate(facility.ldr_site_plan_uploaded_at)}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowReupload(true)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                darkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
              }`}
            >
              <RefreshCcw className="w-3 h-3" />
              Replace
            </button>
          </div>
        ) : (
          <div>
            <InlineLDRSitePlanUpload
              facility={facility}
              darkMode={darkMode}
              onUploaded={() => {
                setShowReupload(false);
                onChange();
              }}
            />
            {showReupload && (
              <button
                type="button"
                onClick={() => setShowReupload(false)}
                className={`mt-2 text-xs ${darkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Cancel replace
              </button>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
