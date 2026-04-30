import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, AlertTriangle, Loader2, CheckCircle, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { buildPlanFilename, pickFacilityFilenameName } from '../utils/spccPlans';

/**
 * Per-berm SPCC Plan download landing page.
 *
 * Stable URL shape: `/spcc-plan/<facility_id>/berm/<berm_index>/download`.
 * The URL only depends on `facility_id` (UUID) and `berm_index` (1..6) —
 * neither of which changes when a berm is relabeled or recertified.
 *
 * On load it:
 *   1. Hits a public SECURITY DEFINER RPC (no auth required) to resolve
 *      the plan + facility metadata for the URL's (facility_id, berm_index).
 *   2. Builds the canonical filename for the *current* state — Renewal
 *      when `recertified_date` is set, otherwise SPCC Plan.
 *   3. Fetches the underlying PDF from Supabase Storage.
 *   4. Triggers a browser download with the canonical filename via Blob +
 *      anchor (works cross-origin without depending on the storage URL's
 *      filename or any Content-Disposition header).
 *
 * Result: the URL stays the same for the life of the plan. The downloaded
 * filename always reflects the latest state of the plan.
 */

interface PlanForDownload {
  facility_name: string;
  matched_facility_name: string | null;
  camino_facility_id: string | null;
  plan_url: string;
  pe_stamp_date: string | null;
  recertified_date: string | null;
  berm_index: number;
  berm_label: string | null;
}

type DownloadState =
  | { status: 'loading' }
  | { status: 'downloading'; filename: string }
  | { status: 'done'; filename: string }
  | { status: 'error'; message: string };

export default function SPCCPlanDownloadPage() {
  const { facilityId, bermIndex } = useParams<{ facilityId: string; bermIndex: string }>();
  const [state, setState] = useState<DownloadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;

    const run = async () => {
      try {
        if (!facilityId || !bermIndex) {
          setState({ status: 'error', message: 'Missing facility or berm in URL.' });
          return;
        }
        const idx = parseInt(bermIndex, 10);
        if (!Number.isFinite(idx) || idx < 1 || idx > 6) {
          setState({ status: 'error', message: 'Invalid berm number in URL.' });
          return;
        }

        const { data, error } = await supabase.rpc('get_spcc_plan_for_download', {
          p_facility_id: facilityId,
          p_berm_index: idx,
        });
        if (cancelled) return;
        if (error) throw error;
        if (!data || data.length === 0) {
          setState({
            status: 'error',
            message: 'No SPCC plan on file for this berm yet.',
          });
          return;
        }

        const plan = data[0] as PlanForDownload;

        // Renewal vs Plan: a recertified_date means a recertification has
        // occurred at some point — treat as Renewal. Otherwise Plan.
        const isRenewal = !!plan.recertified_date;
        const dateForFilename =
          (isRenewal ? plan.recertified_date : plan.pe_stamp_date) ||
          new Date().toISOString().slice(0, 10);

        const filename = buildPlanFilename({
          facilityName: pickFacilityFilenameName({
            name: plan.facility_name,
            matched_facility_name: plan.matched_facility_name,
          }),
          caminoFacilityId: plan.camino_facility_id,
          kind: isRenewal ? 'renewal' : 'plan',
          date: dateForFilename,
        });

        setState({ status: 'downloading', filename });

        // Fetch the actual PDF. Cache-buster avoids stale local cache after
        // a recent recertification overwrite.
        const sep = plan.plan_url.includes('?') ? '&' : '?';
        const res = await fetch(`${plan.plan_url}${sep}v=${Date.now()}`);
        if (!res.ok) throw new Error(`PDF fetch failed (${res.status}).`);
        const blob = await res.blob();
        if (cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        createdObjectUrl = objectUrl;

        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setState({ status: 'done', filename });
      } catch (err: any) {
        if (cancelled) return;
        console.error('SPCC plan download failed:', err);
        setState({
          status: 'error',
          message: err?.message || 'Could not prepare the download.',
        });
      }
    };

    run();
    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [facilityId, bermIndex]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-md border border-gray-200 p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-blue-50 flex items-center justify-center">
          <FileText className="w-6 h-6 text-blue-600" />
        </div>

        <h1 className="text-xl font-semibold text-gray-900">SPCC Plan Download</h1>

        {state.status === 'loading' && (
          <div className="mt-6 flex items-center justify-center gap-2 text-gray-600">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Looking up your plan…</span>
          </div>
        )}

        {state.status === 'downloading' && (
          <div className="mt-6 space-y-2 text-gray-700">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span>Downloading…</span>
            </div>
            <p className="text-sm text-gray-500 break-all">{state.filename}</p>
          </div>
        )}

        {state.status === 'done' && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">Download started</span>
            </div>
            <p className="text-sm text-gray-600 break-all">{state.filename}</p>
            <p className="text-xs text-gray-500">You can close this tab.</p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-medium">Couldn't download</span>
            </div>
            <p className="text-sm text-gray-600">{state.message}</p>
          </div>
        )}

        <p className="mt-8 text-[11px] text-gray-400 inline-flex items-center gap-1">
          <Download className="w-3 h-3" />
          Permanent download link — bookmark or share freely.
        </p>
      </div>
    </div>
  );
}
