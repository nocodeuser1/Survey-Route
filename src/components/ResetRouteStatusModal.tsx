import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { ResetRouteStatusScope } from '../lib/supabase';
import ModalPortal from './ModalPortal';

interface Props {
  open: boolean;
  routeName?: string;
  teamNumber?: number;
  stopCount: number;
  defaultScope: ResetRouteStatusScope;
  canReset: boolean;
  offline: boolean;
  resetting: boolean;
  error?: string | null;
  onClose: () => void;
  onReset: (scope: ResetRouteStatusScope, requestId: string) => Promise<void>;
}

const LABELS: Record<ResetRouteStatusScope, string> = {
  spcc_inspection: 'SPCC Inspection',
  spcc_plan: 'SPCC Plan',
  all: 'All Facilities',
};

export default function ResetRouteStatusModal({
  open, routeName, teamNumber, stopCount, defaultScope, canReset, offline,
  resetting, error, onClose, onReset,
}: Props) {
  const [scope, setScope] = useState<ResetRouteStatusScope>(defaultScope);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setScope(defaultScope);
    setRequestId(crypto.randomUUID());
  }, [defaultScope, open, routeName, teamNumber]);

  const disabledReason = useMemo(() => {
    if (!canReset) return 'Save this route before resetting route status.';
    if (offline) return 'A network connection is required to reset route status.';
    return null;
  }, [canReset, offline]);

  if (!open) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/50 p-4" role="presentation">
        <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-800" role="dialog" aria-modal="true" aria-labelledby="reset-route-status-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="reset-route-status-title" className="text-lg font-semibold text-gray-900 dark:text-white">Reset route status</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {routeName || 'Current saved route'} · Team {teamNumber || 1}
              </p>
            </div>
            <button type="button" onClick={onClose} disabled={resetting} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          <fieldset className="mt-5 space-y-2">
            <legend className="mb-2 text-sm font-medium text-gray-800 dark:text-gray-100">Status to reset</legend>
            {(Object.keys(LABELS) as ResetRouteStatusScope[]).map(option => (
              <label key={option} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 ${scope === option ? 'border-red-600 bg-red-600 text-white dark:border-red-600 dark:bg-red-600' : 'border-gray-200 dark:border-gray-700'}`}>
                <input type="radio" name="reset-route-status-scope" value={option} checked={scope === option} onChange={() => { setScope(option); setRequestId(crypto.randomUUID()); }} disabled={resetting} />
                <span className={`text-sm font-medium ${scope === option ? 'text-white' : 'text-gray-900 dark:text-white'}`}>{LABELS[option]}</span>
              </label>
            ))}
          </fieldset>

          <p className="mt-4 text-sm text-gray-700 dark:text-gray-200">
            {scope === 'all'
              ? `${stopCount} current-route facilities are affected; both Inspection and Plan status domains will reset.`
              : `${stopCount} current-route stops are affected.`}
          </p>
          <p className="mt-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-900/50 dark:text-gray-200">
            {scope === 'spcc_inspection'
              ? 'Every current-route facility will return to Pending in Survey Mode so you can start a new inspection. Prior inspection records and dates stay in History.'
              : scope === 'all'
                ? 'Every current-route facility will start fresh in both status domains. Prior inspection records, SPCC plans, photos, schedules, and route assignments are preserved.'
                : 'This starts fresh Plan route status. SPCC plans, photos, schedules, route assignments, and inspection history are preserved.'}
          </p>

          {(disabledReason || error) && (
            <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error || disabledReason}</p>
          )}

          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={onClose} disabled={resetting} className="min-h-11 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">Cancel</button>
            <button
              type="button"
              disabled={resetting || Boolean(disabledReason)}
              onClick={() => void onReset(scope, requestId).catch(() => undefined)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${resetting ? 'animate-spin' : ''}`} />
              {resetting ? 'Resetting...' : 'Reset route status'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
