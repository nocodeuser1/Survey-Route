import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import type { PendingInspectionRouteCompletion } from '../hooks/useRouteStatusRuns';

interface Props {
  pending: PendingInspectionRouteCompletion | null;
  pendingCount?: number;
  retrying: boolean;
  onRetry: () => Promise<boolean>;
  onDismiss: () => void;
}

export default function RouteStatusCompletionNotice({ pending, pendingCount = 1, retrying, onRetry, onDismiss }: Props) {
  if (!pending) return null;
  return (
    <div className="fixed inset-x-3 top-20 z-[2500] mx-auto max-w-2xl rounded-xl bg-amber-600 p-4 text-white shadow-2xl" role="alert" aria-live="assertive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-white" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">Inspection saved; route check still pending</p>
          <p className="mt-1 text-sm text-white">{pending.message}</p>
          <p className="mt-1 text-xs text-white">
            Facility {pending.facilityId}{pendingCount > 1 ? ` · ${pendingCount} route-status updates awaiting retry` : ''}
          </p>
          <button
            type="button"
            disabled={retrying}
            onClick={() => void onRetry()}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Retrying...' : 'Retry route status'}
          </button>
        </div>
        <button type="button" onClick={onDismiss} disabled={retrying} className="rounded-lg bg-amber-700 p-2 text-white hover:bg-amber-800 disabled:opacity-60" aria-label="Dismiss route-status warning">
          <X className="h-4 w-4 text-white" />
        </button>
      </div>
    </div>
  );
}
