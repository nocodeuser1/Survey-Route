import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, FileText, Flag, Loader2, X } from 'lucide-react';
import ModalPortal from './ModalPortal';
import { supabase, type Inspection, type InspectionPhoto, type InspectionQuestion } from '../lib/supabase';
import { groupResponseEvents, reportableEvents } from '../utils/inspectionEvents';
import { getInspectionFindings } from '../utils/inspectionFindings';
import { getDisplayTimestamp } from '../utils/inspectionTimestamp';

interface InspectionFindingsModalProps {
  inspection: Inspection;
  facilityName: string;
  doneQuestionIds: ReadonlySet<string>;
  /** Called after a check-off is saved, with the inspection's new done set. */
  onDoneChange: (inspectionId: string, next: Set<string>) => void;
  onViewFullReport: () => void;
  onClose: () => void;
}

function FindingPhoto({ photo, onOpen }: { photo: InspectionPhoto; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from('inspection-photos')
      .createSignedUrl(photo.photo_url, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [photo.photo_url]);

  if (failed) {
    return (
      <div className="w-24 h-24 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">
        Failed to load
      </div>
    );
  }
  if (!url) {
    return (
      <div className="w-24 h-24 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      </div>
    );
  }
  return (
    <button type="button" onClick={() => onOpen(url)} className="block">
      <img
        src={url}
        alt={photo.file_name}
        className="w-24 h-24 object-cover rounded-md border border-gray-300 dark:border-gray-600 hover:border-blue-500 transition-colors"
      />
    </button>
  );
}

export default function InspectionFindingsModal({
  inspection,
  facilityName,
  doneQuestionIds,
  onDoneChange,
  onViewFullReport,
  onClose,
}: InspectionFindingsModalProps) {
  const [questions, setQuestions] = useState<Map<string, InspectionQuestion>>(new Map());
  const [photosByQuestion, setPhotosByQuestion] = useState<Record<string, InspectionPhoto[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const findings = useMemo(() => getInspectionFindings(inspection), [inspection]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [templateRes, photosRes] = await Promise.all([
        supabase.from('inspection_templates').select('questions').eq('id', inspection.template_id).maybeSingle(),
        supabase
          .from('inspection_photos')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      const qMap = new Map<string, InspectionQuestion>();
      for (const q of (templateRes.data?.questions as InspectionQuestion[] | undefined) ?? []) qMap.set(q.id, q);
      setQuestions(qMap);
      const grouped: Record<string, InspectionPhoto[]> = {};
      for (const photo of (photosRes.data as InspectionPhoto[] | null) ?? []) {
        (grouped[photo.question_id] ||= []).push(photo);
      }
      setPhotosByQuestion(grouped);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [inspection.id, inspection.template_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightboxUrl) setLightboxUrl(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxUrl, onClose]);

  const toggleDone = async (questionId: string) => {
    const wasDone = doneQuestionIds.has(questionId);
    setSavingId(questionId);
    setError(null);
    const { error: writeError } = wasDone
      ? await supabase
          .from('inspection_item_followups')
          .delete()
          .eq('inspection_id', inspection.id)
          .eq('question_id', questionId)
      : await supabase
          .from('inspection_item_followups')
          .upsert({ inspection_id: inspection.id, question_id: questionId }, { onConflict: 'inspection_id,question_id' });
    setSavingId(null);
    if (writeError) {
      setError(`Couldn't save that check-off: ${writeError.message}`);
      return;
    }
    const next = new Set(doneQuestionIds);
    if (wasDone) next.delete(questionId);
    else next.add(questionId);
    onDoneChange(inspection.id, next);
  };

  const doneCount = findings.filter((f) => doneQuestionIds.has(f.question_id)).length;
  const conducted = new Date(getDisplayTimestamp(inspection)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={onClose}>
        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Last inspection findings
              </p>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{facilityName}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {conducted} · {inspection.inspector_name} ·{' '}
                {findings.length === 0
                  ? 'all items passed'
                  : `${doneCount} of ${findings.length} checked off`}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {error && (
              <div className="rounded-lg border border-red-400 p-3 text-sm text-red-700 dark:text-red-300" role="alert">
                {error}
              </div>
            )}
            {findings.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                Nothing was flagged on this inspection.
              </div>
            ) : loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading findings…
              </div>
            ) : (
              findings.map((finding, index) => {
                const question = questions.get(finding.question_id);
                const done = doneQuestionIds.has(finding.question_id);
                const events = reportableEvents(
                  groupResponseEvents(finding, photosByQuestion[finding.question_id] ?? []),
                );
                return (
                  <div
                    key={finding.question_id}
                    className={`rounded-lg border p-4 ${
                      done
                        ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => toggleDone(finding.question_id)}
                        disabled={savingId !== null}
                        className="mt-0.5 flex-shrink-0 disabled:opacity-60"
                        aria-label={done ? 'Mark as not done' : 'Mark as done'}
                        title={done ? 'Mark as not done' : 'Mark as done'}
                      >
                        {savingId === finding.question_id ? (
                          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                        ) : done ? (
                          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                        ) : (
                          <Circle className="w-5 h-5 text-gray-400 hover:text-green-600" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {question?.category ? `${question.category} · ` : ''}Item {index + 1}
                          </span>
                          {finding.answer === 'no' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                              <Flag className="w-3 h-3" /> Answered No
                            </span>
                          )}
                          {finding.action_required && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">
                              <AlertTriangle className="w-3 h-3" /> Action required
                            </span>
                          )}
                        </div>
                        <p
                          className={`mt-1 text-sm font-medium ${
                            done ? 'text-gray-500 dark:text-gray-400 line-through' : 'text-gray-900 dark:text-white'
                          }`}
                        >
                          {question?.text ?? finding.question_id}
                        </p>
                        {finding.action_required && finding.action_notes?.trim() && (
                          <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
                            <span className="font-medium">Action: </span>
                            {finding.action_notes}
                          </p>
                        )}
                        {events.map((event, eventIndex) => (
                          <div key={event.eventId ?? 'first'} className="mt-2">
                            {event.description.trim() && (
                              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                {events.length > 1 && (
                                  <span className="font-medium">Event {eventIndex + 1}: </span>
                                )}
                                {event.description}
                              </p>
                            )}
                            {event.photos.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {event.photos.map((photo) => (
                                  <FindingPhoto key={photo.id} photo={photo} onOpen={setLightboxUrl} />
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex justify-end gap-2 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onViewFullReport}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <FileText className="w-4 h-4" /> View full report
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[10000] p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="Finding photo" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </ModalPortal>
  );
}
