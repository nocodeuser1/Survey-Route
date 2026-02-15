import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mic, MicOff, Camera, X, ChevronRight, SkipForward,
  CheckCircle, Save, Loader2, Image, ArrowLeft, RefreshCw,
  AlertCircle, Volume2, ChevronDown, Trash2, Edit3,
} from 'lucide-react';
import { supabase, Facility, SurveyType, SurveyField, FacilitySurveyData } from '../lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TranscriptEntry {
  text: string;
  timestamp: number; // Date.now()
  isFinal: boolean;
}

interface CapturedPhoto {
  id: string;
  dataUrl: string;
  timestamp: number;
  fieldId: string | null;
  caption: string;
  transcriptContext: string;
}

interface FieldData {
  fieldId: string;
  value: string | number | boolean | string[] | null;
  photos: CapturedPhoto[];
  voiceTranscript: string;
}

interface HandsFreeModeProps {
  facility: Facility;
  surveyType: SurveyType;
  fields: SurveyField[];
  existingData: FacilitySurveyData[];
  userId: string;
  onClose: () => void;
  onSaved?: () => void;
}

// ─── Voice command patterns ─────────────────────────────────────────────────

const PHOTO_COMMANDS = [
  'take a picture', 'take picture', 'take a photo', 'take photo',
  'capture photo', 'capture image', 'snap photo', 'photograph',
];
const NEXT_COMMANDS = ['next field', 'next', 'go next', 'move on'];
const SKIP_COMMANDS = ['skip', 'skip field', 'skip this'];
const DONE_COMMANDS = ['done', 'finish', 'complete', "i'm done", 'all done', 'finished'];

function matchesCommand(text: string, commands: string[]): boolean {
  const lower = text.toLowerCase().trim();
  return commands.some(cmd => lower.includes(cmd));
}

// ─── Unique ID helper ───────────────────────────────────────────────────────

let _idCounter = 0;
function uid(): string {
  return `hf-${Date.now()}-${++_idCounter}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function HandsFreeMode({
  facility,
  surveyType,
  fields,
  existingData,
  userId,
  onClose,
  onSaved,
}: HandsFreeModeProps) {
  // Filter to voice-enabled fields only
  const voiceFields = fields.filter(f => f.voice_input_enabled);

  // ── State ───────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<'recording' | 'review'>('recording');
  const [currentFieldIdx, setCurrentFieldIdx] = useState(0);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interimText, setInterimText] = useState('');
  const [fieldData, setFieldData] = useState<Record<string, FieldData>>({});
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [editingPhoto, setEditingPhoto] = useState<string | null>(null);
  const [editingCaption, setEditingCaption] = useState('');

  // Refs
  const recognitionRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptBufferRef = useRef<TranscriptEntry[]>([]);
  const restartTimeoutRef = useRef<number | null>(null);

  const currentField = voiceFields[currentFieldIdx] ?? null;

  // ── Initialize field data from existing ─────────────────────────────────
  useEffect(() => {
    const initial: Record<string, FieldData> = {};
    for (const field of voiceFields) {
      const existing = existingData.find(d => d.field_id === field.id);
      initial[field.id] = {
        fieldId: field.id,
        value: existing?.value ?? null,
        photos: [],
        voiceTranscript: '',
      };
    }
    setFieldData(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keep transcript buffer (30s rolling) ────────────────────────────────
  useEffect(() => {
    transcriptBufferRef.current = transcript;
  }, [transcript]);

  const getRecentTranscript = useCallback((seconds: number = 30): string => {
    const cutoff = Date.now() - seconds * 1000;
    return transcriptBufferRef.current
      .filter(e => e.timestamp >= cutoff && e.isFinal)
      .map(e => e.text)
      .join(' ');
  }, []);

  // ── Scroll transcript to bottom ────────────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, interimText]);

  // ── Speech Recognition ─────────────────────────────────────────────────
  const startRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('Speech recognition is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setMicError(null);
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          const entry: TranscriptEntry = {
            text: text.trim(),
            timestamp: Date.now(),
            isFinal: true,
          };
          setTranscript(prev => [...prev, entry]);
          setInterimText('');

          // Check for voice commands
          handleVoiceCommand(text);
        } else {
          interim = text;
        }
      }
      if (interim) {
        setInterimText(interim);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('[HandsFree] Recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setMicError('Microphone access denied. Please allow microphone permissions.');
        setListening(false);
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        // Auto-restart on transient errors
        scheduleRestart();
      }
    };

    recognition.onend = () => {
      // Auto-restart if we're still supposed to be listening
      if (recognitionRef.current === recognition) {
        scheduleRestart();
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleRestart = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
    }
    restartTimeoutRef.current = window.setTimeout(() => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // Already running or disposed
        }
      }
    }, 300);
  }, []);

  const stopRecognition = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try {
        rec.stop();
      } catch {
        // Ignore
      }
    }
    setListening(false);
  }, []);

  // Start recognition on mount
  useEffect(() => {
    startRecognition();
    return () => {
      stopRecognition();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice command handler ──────────────────────────────────────────────
  const handleVoiceCommand = useCallback((text: string) => {
    if (matchesCommand(text, PHOTO_COMMANDS)) {
      triggerPhotoCapture();
    } else if (matchesCommand(text, NEXT_COMMANDS)) {
      advanceField();
    } else if (matchesCommand(text, SKIP_COMMANDS)) {
      advanceField();
    } else if (matchesCommand(text, DONE_COMMANDS)) {
      finishRecording();
    } else {
      // Map speech to current field
      appendToCurrentField(text);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Field navigation ───────────────────────────────────────────────────
  const advanceField = useCallback(() => {
    setCurrentFieldIdx(prev => {
      const next = prev + 1;
      if (next >= voiceFields.length) {
        return prev; // Stay on last field
      }
      return next;
    });
  }, [voiceFields.length]);

  const goToField = useCallback((idx: number) => {
    if (idx >= 0 && idx < voiceFields.length) {
      setCurrentFieldIdx(idx);
    }
  }, [voiceFields.length]);

  // ── Append speech to current field ─────────────────────────────────────
  const appendToCurrentField = useCallback((text: string) => {
    if (!currentField) return;
    setFieldData(prev => {
      const fd = prev[currentField.id] || {
        fieldId: currentField.id,
        value: null,
        photos: [],
        voiceTranscript: '',
      };
      const existingTranscript = fd.voiceTranscript || '';
      const newTranscript = existingTranscript
        ? `${existingTranscript} ${text.trim()}`
        : text.trim();

      // Update the value based on field type
      let newValue: FieldData['value'] = newTranscript;
      if (currentField.field_type === 'number') {
        const nums = newTranscript.match(/\d+\.?\d*/g);
        newValue = nums ? parseFloat(nums[nums.length - 1]) : fd.value;
      } else if (currentField.field_type === 'checkbox') {
        const lower = text.toLowerCase();
        if (lower.includes('yes') || lower.includes('true') || lower.includes('check')) {
          newValue = true;
        } else if (lower.includes('no') || lower.includes('false') || lower.includes('uncheck')) {
          newValue = false;
        } else {
          newValue = fd.value;
        }
      } else if (currentField.field_type === 'select') {
        // Try to match spoken text to an option
        const options: string[] = Array.isArray(currentField.options) ? currentField.options : [];
        const lower = text.toLowerCase();
        const match = options.find(opt => lower.includes(opt.toLowerCase()));
        newValue = match || fd.value;
      } else {
        newValue = newTranscript;
      }

      return {
        ...prev,
        [currentField.id]: {
          ...fd,
          value: newValue,
          voiceTranscript: newTranscript,
        },
      };
    });
  }, [currentField]);

  // ── Photo capture ──────────────────────────────────────────────────────
  const triggerPhotoCapture = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePhotoCaptured = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const timestamp = Date.now();

      // Get transcript context for last 15 seconds
      const context = getRecentTranscript(15);

      // Match photo to a field using keywords + current field
      const matchedFieldId = matchPhotoToField(context);

      // Auto-generate caption from preceding speech
      const caption = generateCaption(context);

      const photo: CapturedPhoto = {
        id: uid(),
        dataUrl,
        timestamp,
        fieldId: matchedFieldId,
        caption,
        transcriptContext: context,
      };

      setPhotos(prev => [...prev, photo]);

      // Also attach to field data
      if (matchedFieldId) {
        setFieldData(prev => {
          const fd = prev[matchedFieldId] || {
            fieldId: matchedFieldId,
            value: null,
            photos: [],
            voiceTranscript: '',
          };
          return {
            ...prev,
            [matchedFieldId]: {
              ...fd,
              photos: [...fd.photos, photo],
            },
          };
        });
      }
    };
    reader.readAsDataURL(file);

    // Reset input so the same file can be selected again
    e.target.value = '';
  }, [getRecentTranscript]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Field matching from transcript context ─────────────────────────────
  const matchPhotoToField = useCallback((context: string): string | null => {
    if (!context) return currentField?.id ?? null;

    const lower = context.toLowerCase();
    let bestMatch: { fieldId: string; score: number } | null = null;

    for (const field of voiceFields) {
      let score = 0;

      // Check voice_keywords
      if (field.voice_keywords && field.voice_keywords.length > 0) {
        for (const keyword of field.voice_keywords) {
          if (lower.includes(keyword.toLowerCase())) {
            score += 3; // Keywords are strong signals
          }
        }
      }

      // Check field name words
      const nameWords = field.name.toLowerCase().split(/\s+/);
      for (const word of nameWords) {
        if (word.length > 2 && lower.includes(word)) {
          score += 1;
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { fieldId: field.id, score };
      }
    }

    return bestMatch?.fieldId ?? currentField?.id ?? null;
  }, [voiceFields, currentField]);

  // ── Caption generation from transcript ─────────────────────────────────
  const generateCaption = useCallback((context: string): string => {
    if (!context) return '';
    // Take the last ~100 chars as a caption summary
    const trimmed = context.trim();
    if (trimmed.length <= 120) return trimmed;
    return '...' + trimmed.slice(-117);
  }, []);

  // ── Finish recording → review ──────────────────────────────────────────
  const finishRecording = useCallback(() => {
    stopRecognition();
    setPhase('review');
  }, [stopRecognition]);

  // ── Reassign photo to different field ──────────────────────────────────
  const reassignPhoto = useCallback((photoId: string, newFieldId: string | null) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, fieldId: newFieldId } : p));

    // Update fieldData: remove from old, add to new
    setFieldData(prev => {
      const updated = { ...prev };
      // Remove from all fields
      for (const fid of Object.keys(updated)) {
        updated[fid] = {
          ...updated[fid],
          photos: updated[fid].photos.filter(p => p.id !== photoId),
        };
      }
      // Add to new field
      if (newFieldId && updated[newFieldId]) {
        const photo = photos.find(p => p.id === photoId);
        if (photo) {
          updated[newFieldId] = {
            ...updated[newFieldId],
            photos: [...updated[newFieldId].photos, { ...photo, fieldId: newFieldId }],
          };
        }
      }
      return updated;
    });
  }, [photos]);

  // ── Delete photo ───────────────────────────────────────────────────────
  const deletePhoto = useCallback((photoId: string) => {
    setPhotos(prev => prev.filter(p => p.id !== photoId));
    setFieldData(prev => {
      const updated = { ...prev };
      for (const fid of Object.keys(updated)) {
        updated[fid] = {
          ...updated[fid],
          photos: updated[fid].photos.filter(p => p.id !== photoId),
        };
      }
      return updated;
    });
  }, []);

  // ── Update photo caption ───────────────────────────────────────────────
  const updatePhotoCaption = useCallback((photoId: string, caption: string) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, caption } : p));
    setFieldData(prev => {
      const updated = { ...prev };
      for (const fid of Object.keys(updated)) {
        updated[fid] = {
          ...updated[fid],
          photos: updated[fid].photos.map(p => p.id === photoId ? { ...p, caption } : p),
        };
      }
      return updated;
    });
  }, []);

  // ── Save to Supabase ───────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);

      for (const field of voiceFields) {
        const fd = fieldData[field.id];
        if (!fd) continue;

        // Skip fields with no data captured
        const hasValue = fd.value !== null && fd.value !== '' && fd.value !== undefined;
        const hasPhotos = fd.photos.length > 0;
        if (!hasValue && !hasPhotos) continue;

        const photoPayload = fd.photos.map(p => ({
          url: p.dataUrl,
          caption: p.caption,
          timestamp: new Date(p.timestamp).toISOString(),
          transcript_context: p.transcriptContext,
        }));

        const existing = existingData.find(d => d.field_id === field.id);

        if (existing) {
          const { error } = await supabase
            .from('facility_survey_data')
            .update({
              value: fd.value,
              photos: hasPhotos ? photoPayload : existing.photos,
              completed_by: userId,
              completed_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('facility_survey_data')
            .insert({
              facility_id: facility.id,
              survey_type_id: surveyType.id,
              field_id: field.id,
              value: fd.value,
              photos: hasPhotos ? photoPayload : null,
              completed_by: userId,
              completed_at: new Date().toISOString(),
            });
          if (error) throw error;
        }
      }

      setSaved(true);
      onSaved?.();
    } catch (err: any) {
      console.error('[HandsFreeMode] Save error:', err);
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ── Format timestamp ───────────────────────────────────────────────────
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // ── Trim transcript buffer beyond 30s ──────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30_000;
      setTranscript(prev => {
        // Keep all entries but mark old ones - we don't remove them from display
        // Only the buffer ref is used for matching, transcript state shows full history
        return prev;
      });
      // Trim the buffer ref
      transcriptBufferRef.current = transcriptBufferRef.current.filter(
        e => e.timestamp >= cutoff
      );
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Field name helper ──────────────────────────────────────────────────
  const getFieldName = (fieldId: string | null): string => {
    if (!fieldId) return 'Unassigned';
    return voiceFields.find(f => f.id === fieldId)?.name ?? 'Unknown';
  };

  // ─── Recording Phase ──────────────────────────────────────────────────
  if (phase === 'recording') {
    return (
      <div className="fixed inset-0 bg-gray-950 flex flex-col" style={{ zIndex: 999999 }}>
        {/* Hidden file input for photo capture */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoCaptured}
        />

        {/* Header bar */}
        <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => { stopRecognition(); onClose(); }}
              className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70"
            >
              <X className="w-6 h-6" />
            </button>
            <div className="min-w-0">
              <h1 className="text-white font-bold text-lg truncate">{facility.name}</h1>
              <p className="text-white/50 text-sm truncate">{surveyType.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-white/40 text-xs">
              {photos.length} photo{photos.length !== 1 ? 's' : ''}
            </span>
            {listening ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 border border-red-500/40 rounded-full">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400 text-xs font-medium">LIVE</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/40 rounded-full">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-yellow-400 text-xs font-medium">PAUSED</span>
              </span>
            )}
          </div>
        </div>

        {/* Current field indicator */}
        <div className="flex-shrink-0 px-4 py-3 bg-white/5 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wider">Current Field</p>
              <p className="text-white text-xl font-bold mt-0.5">
                {currentField?.name ?? 'All fields completed'}
              </p>
              {currentField?.description && (
                <p className="text-white/40 text-sm mt-0.5">{currentField.description}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-white/30 text-xs">
                {currentFieldIdx + 1} / {voiceFields.length}
              </p>
              {/* Field progress dots */}
              <div className="flex items-center gap-1 mt-1">
                {voiceFields.map((f, i) => (
                  <button
                    key={f.id}
                    onClick={() => goToField(i)}
                    className={`w-2.5 h-2.5 rounded-full transition-all ${
                      i === currentFieldIdx
                        ? 'bg-white scale-125'
                        : i < currentFieldIdx
                          ? 'bg-green-500'
                          : 'bg-white/20'
                    }`}
                    title={f.name}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Current field value preview */}
          {currentField && fieldData[currentField.id]?.value && (
            <div className="mt-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
              <p className="text-white/70 text-sm">
                {String(fieldData[currentField.id].value)}
              </p>
            </div>
          )}
        </div>

        {/* Transcript area - scrolling */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {transcript.length === 0 && !interimText && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Volume2 className="w-12 h-12 text-white/20 mb-3" />
              <p className="text-white/40 text-lg">Start speaking...</p>
              <p className="text-white/20 text-sm mt-1">
                Say "take a photo", "next field", "skip", or "done"
              </p>
            </div>
          )}
          {transcript.map((entry, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-white/20 text-xs font-mono mt-1 flex-shrink-0 w-16">
                {formatTime(entry.timestamp)}
              </span>
              <p className="text-white/90 text-base leading-relaxed">
                {entry.text}
              </p>
            </div>
          ))}
          {interimText && (
            <div className="flex items-start gap-2">
              <span className="text-white/20 text-xs font-mono mt-1 flex-shrink-0 w-16">
                {formatTime(Date.now())}
              </span>
              <p className="text-white/40 text-base leading-relaxed italic">
                {interimText}
              </p>
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Voice commands hint bar */}
        <div className="flex-shrink-0 px-4 py-2 bg-white/5 border-t border-white/10 overflow-x-auto">
          <div className="flex items-center gap-2 text-xs text-white/30 whitespace-nowrap">
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10">"take a photo"</span>
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10">"next field"</span>
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10">"skip"</span>
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10">"done"</span>
          </div>
        </div>

        {/* Bottom action bar */}
        <div className="flex-shrink-0 px-4 py-4 bg-gray-950 border-t border-white/10">
          <div className="flex items-center justify-between gap-3">
            {/* Mic toggle */}
            <button
              onClick={() => {
                if (listening) {
                  stopRecognition();
                } else {
                  startRecognition();
                }
              }}
              className={`p-4 rounded-full transition-all ${
                listening
                  ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              {listening ? <Mic className="w-7 h-7" /> : <MicOff className="w-7 h-7" />}
            </button>

            {/* Camera button (floating) */}
            <button
              onClick={triggerPhotoCapture}
              className="p-4 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:bg-blue-500 transition-colors"
            >
              <Camera className="w-7 h-7" />
            </button>

            {/* Nav buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={advanceField}
                disabled={currentFieldIdx >= voiceFields.length - 1}
                className="p-3 rounded-full bg-white/10 text-white/70 hover:bg-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next field"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
              <button
                onClick={finishRecording}
                className="px-5 py-3 rounded-full bg-green-600 text-white font-semibold text-sm hover:bg-green-500 transition-colors shadow-lg shadow-green-600/30"
              >
                Done
              </button>
            </div>
          </div>

          {micError && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-red-500/20 border border-red-500/40 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-xs">{micError}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Review Phase ──────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-gray-950 flex flex-col" style={{ zIndex: 999999 }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setPhase('recording');
              startRecognition();
            }}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-white font-bold text-lg">Review & Save</h1>
            <p className="text-white/40 text-sm">
              {facility.name} — {surveyType.name}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable review content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Field data review */}
        {voiceFields.map((field) => {
          const fd = fieldData[field.id];
          const value = fd?.value;
          const fieldPhotos = photos.filter(p => p.fieldId === field.id);
          const hasValue = value !== null && value !== '' && value !== undefined;
          const hasPhotos = fieldPhotos.length > 0;

          return (
            <div
              key={field.id}
              className={`rounded-xl border p-4 transition-colors ${
                hasValue || hasPhotos
                  ? 'bg-white/5 border-white/20'
                  : 'bg-white/[0.02] border-white/10'
              }`}
            >
              {/* Field header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-semibold text-sm">{field.name}</h3>
                  {field.required && <span className="text-red-400 text-xs">Required</span>}
                </div>
                {hasValue && <CheckCircle className="w-4 h-4 text-green-400" />}
              </div>

              {/* Value */}
              {hasValue ? (
                <div className="mb-2">
                  {field.field_type === 'checkbox' ? (
                    <span className={`text-sm ${value ? 'text-green-400' : 'text-red-400'}`}>
                      {value ? 'Yes' : 'No'}
                    </span>
                  ) : (
                    <p className="text-white/80 text-sm bg-white/5 rounded-lg px-3 py-2">
                      {String(value)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-white/30 text-sm italic mb-2">No data captured</p>
              )}

              {/* Voice transcript for this field */}
              {fd?.voiceTranscript && (
                <div className="mb-2">
                  <p className="text-white/30 text-xs mb-1">Voice transcript:</p>
                  <p className="text-white/50 text-xs italic">{fd.voiceTranscript}</p>
                </div>
              )}

              {/* Photos for this field */}
              {hasPhotos && (
                <div className="space-y-2 mt-2">
                  <p className="text-white/40 text-xs">{fieldPhotos.length} photo{fieldPhotos.length !== 1 ? 's' : ''}</p>
                  <div className="flex flex-wrap gap-2">
                    {fieldPhotos.map(photo => (
                      <div key={photo.id} className="relative group">
                        <img
                          src={photo.dataUrl}
                          alt={photo.caption || 'Captured'}
                          className="w-20 h-20 object-cover rounded-lg border border-white/20"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 rounded-lg flex items-center justify-center gap-1 transition-opacity">
                          <button
                            onClick={() => deletePhoto(photo.id)}
                            className="p-1 rounded bg-red-500/80 text-white"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        {photo.caption && (
                          <p className="text-white/40 text-[10px] mt-0.5 truncate max-w-[80px]">{photo.caption}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Unassigned photos */}
        {(() => {
          const unassigned = photos.filter(p => !p.fieldId);
          if (unassigned.length === 0) return null;
          return (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
              <h3 className="text-yellow-400 font-semibold text-sm mb-2">
                Unassigned Photos ({unassigned.length})
              </h3>
              <p className="text-white/40 text-xs mb-3">
                Assign these photos to a field using the dropdown.
              </p>
              <div className="space-y-3">
                {unassigned.map(photo => (
                  <div key={photo.id} className="flex items-start gap-3">
                    <img
                      src={photo.dataUrl}
                      alt={photo.caption || 'Captured'}
                      className="w-16 h-16 object-cover rounded-lg border border-white/20 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* Caption editing */}
                      {editingPhoto === photo.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editingCaption}
                            onChange={(e) => setEditingCaption(e.target.value)}
                            className="flex-1 px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-xs"
                            autoFocus
                          />
                          <button
                            onClick={() => {
                              updatePhotoCaption(photo.id, editingCaption);
                              setEditingPhoto(null);
                            }}
                            className="p-1 text-green-400"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <p className="text-white/60 text-xs truncate">
                            {photo.caption || 'No caption'}
                          </p>
                          <button
                            onClick={() => {
                              setEditingPhoto(photo.id);
                              setEditingCaption(photo.caption);
                            }}
                            className="p-0.5 text-white/30 hover:text-white/60"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Reassign dropdown */}
                      <div className="relative">
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              reassignPhoto(photo.id, e.target.value);
                            }
                          }}
                          className="w-full px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-xs appearance-none pr-6"
                        >
                          <option value="">Assign to field...</option>
                          {voiceFields.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1.5 w-3 h-3 text-white/40 pointer-events-none" />
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => deletePhoto(photo.id)}
                        className="flex items-center gap-1 text-red-400/60 hover:text-red-400 text-xs"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* All photos grid */}
        {photos.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="text-white/60 font-semibold text-sm mb-3 flex items-center gap-2">
              <Image className="w-4 h-4" />
              All Photos ({photos.length})
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {photos.map(photo => (
                <div key={photo.id} className="relative group">
                  <img
                    src={photo.dataUrl}
                    alt={photo.caption || 'Captured'}
                    className="w-full aspect-square object-cover rounded-lg border border-white/10"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 rounded-b-lg">
                    <p className="text-white/80 text-[10px] truncate">
                      {getFieldName(photo.fieldId)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save bar */}
      <div className="flex-shrink-0 px-4 py-4 border-t border-white/10 bg-gray-950">
        {saveError && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-500/20 border border-red-500/40 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-xs">{saveError}</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 text-sm font-medium text-white/60 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold rounded-xl transition-colors ${
              saved
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/30'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Saved
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Survey
              </>
            )}
          </button>
        </div>

        {saved && (
          <button
            onClick={onClose}
            className="mt-3 w-full px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors text-center"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
