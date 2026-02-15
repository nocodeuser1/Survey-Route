import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Mic, MicOff, Camera, X, ChevronRight, ChevronLeft,
  CheckCircle, Save, Loader2, Image, ArrowLeft,
  AlertCircle, Volume2, ChevronDown, Trash2, Edit3,
} from 'lucide-react';
import { supabase, Facility, SurveyType, SurveyField, FacilitySurveyData } from '../lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TranscriptEntry {
  text: string;
  timestamp: number;
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
  'snap a pic', 'snap pic', 'snap a picture', 'get a photo',
  'get a picture', 'take a shot', 'take shot', 'photo please',
  'picture please', 'camera',
];
const NEXT_COMMANDS = ['next field', 'next', 'go next', 'move on', 'continue', 'next one', 'go to next', 'forward'];
const SKIP_COMMANDS = ['skip', 'skip field', 'skip this', 'pass', 'skip it', 'skip this one'];
const DONE_COMMANDS = [
  'done', 'finish', 'complete', "i'm done", 'all done', 'finished',
  'we are done', "that's it", 'thats it', "that's all", 'thats all',
  'wrap up', 'save it', 'complete survey',
];
const BACK_COMMANDS = ['go back', 'previous', 'previous field', 'back', 'go to previous'];

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
  const [editingFieldValue, setEditingFieldValue] = useState<string | null>(null);
  const [editingFieldText, setEditingFieldText] = useState('');
  const [commandFlash, setCommandFlash] = useState<string | null>(null);

  // Refs
  const recognitionRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptBufferRef = useRef<TranscriptEntry[]>([]);
  const restartTimeoutRef = useRef<number | null>(null);
  const commandFlashTimeoutRef = useRef<number | null>(null);
  const restartAttemptsRef = useRef(0);
  const listeningRef = useRef(false);
  // Refs to track mutable state for callbacks
  const currentFieldIdxRef = useRef(currentFieldIdx);
  const fieldDataRef = useRef(fieldData);
  const photosRef = useRef(photos);

  const currentField = voiceFields[currentFieldIdx] ?? null;

  // Keep refs in sync
  useEffect(() => { currentFieldIdxRef.current = currentFieldIdx; }, [currentFieldIdx]);
  useEffect(() => { fieldDataRef.current = fieldData; }, [fieldData]);
  useEffect(() => { photosRef.current = photos; }, [photos]);

  // ── Flash a command label briefly ────────────────────────────────────
  const flashCommand = useCallback((label: string) => {
    setCommandFlash(label);
    if (commandFlashTimeoutRef.current) clearTimeout(commandFlashTimeoutRef.current);
    commandFlashTimeoutRef.current = window.setTimeout(() => setCommandFlash(null), 1500);
  }, []);

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

  // ── Field matching from transcript context ─────────────────────────────
  const matchPhotoToField = useCallback((context: string): string | null => {
    const cf = voiceFields[currentFieldIdxRef.current] ?? null;
    if (!context) return cf?.id ?? null;

    const lower = context.toLowerCase();
    let bestMatch: { fieldId: string; score: number } | null = null;

    for (const field of voiceFields) {
      if (!field.photo_capture_enabled) continue;
      let score = 0;

      if (field.voice_keywords && field.voice_keywords.length > 0) {
        for (const keyword of field.voice_keywords) {
          if (lower.includes(keyword.toLowerCase())) {
            score += 3;
          }
        }
      }

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

    return bestMatch?.fieldId ?? cf?.id ?? null;
  }, [voiceFields]);

  // ── Caption generation from transcript ─────────────────────────────────
  const generateCaption = useCallback((context: string): string => {
    if (!context) return '';
    const trimmed = context.trim();
    if (trimmed.length <= 120) return trimmed;
    return '...' + trimmed.slice(-117);
  }, []);

  // ── Append speech to current field ─────────────────────────────────────
  const appendToCurrentField = useCallback((text: string) => {
    const cf = voiceFields[currentFieldIdxRef.current] ?? null;
    if (!cf) return;

    setFieldData(prev => {
      const fd = prev[cf.id] || {
        fieldId: cf.id,
        value: null,
        photos: [],
        voiceTranscript: '',
      };
      const existingTranscript = fd.voiceTranscript || '';
      const newTranscript = existingTranscript
        ? `${existingTranscript} ${text.trim()}`
        : text.trim();

      let newValue: FieldData['value'] = newTranscript;

      if (cf.field_type === 'number') {
        const nums = newTranscript.match(/\d+\.?\d*/g);
        newValue = nums ? parseFloat(nums[nums.length - 1]) : fd.value;
      } else if (cf.field_type === 'checkbox') {
        const lower = text.toLowerCase();
        if (lower.includes('yes') || lower.includes('true') || lower.includes('check') || lower.includes('affirmative')) {
          newValue = true;
        } else if (lower.includes('no') || lower.includes('false') || lower.includes('uncheck') || lower.includes('negative')) {
          newValue = false;
        } else {
          newValue = fd.value;
        }
      } else if (cf.field_type === 'select') {
        const options: string[] = Array.isArray(cf.options) ? cf.options : [];
        const lower = text.toLowerCase();
        const match = options.find(opt => lower.includes(opt.toLowerCase()));
        newValue = match || fd.value;
      } else if (cf.field_type === 'multi_select') {
        const options: string[] = Array.isArray(cf.options) ? cf.options : [];
        const lower = text.toLowerCase();
        const currentArr = Array.isArray(fd.value) ? fd.value as string[] : [];
        const newSelections = [...currentArr];
        for (const opt of options) {
          if (lower.includes(opt.toLowerCase()) && !newSelections.includes(opt)) {
            newSelections.push(opt);
          }
        }
        newValue = newSelections.length > 0 ? newSelections : fd.value;
      } else if (cf.field_type === 'rating') {
        const lower = text.toLowerCase();
        const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
        let rating: number | null = null;
        for (const [word, num] of Object.entries(numberWords)) {
          if (lower.includes(word)) { rating = num; break; }
        }
        if (!rating) {
          const match = text.match(/[1-5]/);
          if (match) rating = parseInt(match[0]);
        }
        newValue = rating ?? fd.value;
      } else if (cf.field_type === 'date') {
        // Keep raw transcript; user can edit in review
        newValue = newTranscript;
      } else {
        newValue = newTranscript;
      }

      return {
        ...prev,
        [cf.id]: {
          ...fd,
          value: newValue,
          voiceTranscript: newTranscript,
        },
      };
    });
  }, [voiceFields]);

  // ── Field navigation ───────────────────────────────────────────────────
  const advanceField = useCallback(() => {
    setCurrentFieldIdx(prev => {
      const next = prev + 1;
      if (next >= voiceFields.length) return prev;
      return next;
    });
  }, [voiceFields.length]);

  const goToField = useCallback((idx: number) => {
    if (idx >= 0 && idx < voiceFields.length) {
      setCurrentFieldIdx(idx);
    }
  }, [voiceFields.length]);

  const goBack = useCallback(() => {
    setCurrentFieldIdx(prev => Math.max(0, prev - 1));
  }, []);

  // ── Finish recording → review ──────────────────────────────────────────
  const finishRecording = useCallback(() => {
    stopRecognition();
    setPhase('review');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      const context = getRecentTranscript(15);
      const matchedFieldId = matchPhotoToField(context);
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
            [matchedFieldId]: { ...fd, photos: [...fd.photos, photo] },
          };
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [getRecentTranscript, matchPhotoToField, generateCaption]);

  // ── Voice command handler ──────────────────────────────────────────────
  const handleVoiceCommand = useCallback((text: string) => {
    if (matchesCommand(text, PHOTO_COMMANDS)) {
      flashCommand('Photo');
      triggerPhotoCapture();
    } else if (matchesCommand(text, DONE_COMMANDS)) {
      flashCommand('Done');
      finishRecording();
    } else if (matchesCommand(text, NEXT_COMMANDS)) {
      flashCommand('Next');
      advanceField();
    } else if (matchesCommand(text, SKIP_COMMANDS)) {
      flashCommand('Skip');
      advanceField();
    } else if (matchesCommand(text, BACK_COMMANDS)) {
      flashCommand('Back');
      goBack();
    } else {
      appendToCurrentField(text);
    }
  }, [flashCommand, triggerPhotoCapture, finishRecording, advanceField, goBack, appendToCurrentField]);

  // Keep handleVoiceCommand ref stable for recognition callback
  const handleVoiceCommandRef = useRef(handleVoiceCommand);
  useEffect(() => { handleVoiceCommandRef.current = handleVoiceCommand; }, [handleVoiceCommand]);

  // ── Speech Recognition ─────────────────────────────────────────────────
  const scheduleRestart = useCallback(() => {
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    if (restartAttemptsRef.current >= 5) {
      setMicError('Voice recognition stopped after repeated failures. Tap the mic to retry.');
      setListening(false);
      listeningRef.current = false;
      return;
    }
    restartAttemptsRef.current += 1;
    restartTimeoutRef.current = window.setTimeout(() => {
      if (recognitionRef.current && listeningRef.current) {
        try { recognitionRef.current.start(); } catch { /* already running */ }
      }
    }, 300);
  }, []);

  const startRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('Speech recognition not supported. Use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      listeningRef.current = true;
      setMicError(null);
    };

    recognition.onresult = (event: any) => {
      restartAttemptsRef.current = 0;
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
          handleVoiceCommandRef.current(text);
        } else {
          interim = text;
        }
      }
      if (interim) setInterimText(interim);
    };

    recognition.onerror = (event: any) => {
      console.error('[HandsFree] Recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setMicError('Microphone access denied. Please allow microphone permissions.');
        setListening(false);
        listeningRef.current = false;
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        scheduleRestart();
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        scheduleRestart();
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [scheduleRestart]);

  const stopRecognition = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      try { rec.stop(); } catch { /* noop */ }
    }
    setListening(false);
    listeningRef.current = false;
    restartAttemptsRef.current = 0;
  }, []);

  // Start recognition on mount
  useEffect(() => {
    startRecognition();
    return () => { stopRecognition(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trim transcript buffer beyond 30s ──────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - 30_000;
      transcriptBufferRef.current = transcriptBufferRef.current.filter(e => e.timestamp >= cutoff);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Cleanup command flash timeout ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (commandFlashTimeoutRef.current) clearTimeout(commandFlashTimeoutRef.current);
    };
  }, []);

  // ── Photo management ───────────────────────────────────────────────────
  const reassignPhoto = useCallback((photoId: string, newFieldId: string | null) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, fieldId: newFieldId } : p));
    setFieldData(prev => {
      const updated = { ...prev };
      for (const fid of Object.keys(updated)) {
        updated[fid] = { ...updated[fid], photos: updated[fid].photos.filter(p => p.id !== photoId) };
      }
      if (newFieldId && updated[newFieldId]) {
        const photo = photosRef.current.find(p => p.id === photoId);
        if (photo) {
          updated[newFieldId] = {
            ...updated[newFieldId],
            photos: [...updated[newFieldId].photos, { ...photo, fieldId: newFieldId }],
          };
        }
      }
      return updated;
    });
  }, []);

  const deletePhoto = useCallback((photoId: string) => {
    setPhotos(prev => prev.filter(p => p.id !== photoId));
    setFieldData(prev => {
      const updated = { ...prev };
      for (const fid of Object.keys(updated)) {
        updated[fid] = { ...updated[fid], photos: updated[fid].photos.filter(p => p.id !== photoId) };
      }
      return updated;
    });
  }, []);

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

  // ── Update field value in review ───────────────────────────────────────
  const updateFieldValue = useCallback((fieldId: string, value: FieldData['value']) => {
    setFieldData(prev => ({
      ...prev,
      [fieldId]: { ...prev[fieldId], value },
    }));
  }, []);

  // ── Save to Supabase ───────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);

      for (const field of voiceFields) {
        const fd = fieldData[field.id];
        if (!fd) continue;

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

  // ── Helpers ────────────────────────────────────────────────────────────
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getFieldName = (fieldId: string | null): string => {
    if (!fieldId) return 'Unassigned';
    return voiceFields.find(f => f.id === fieldId)?.name ?? 'Unknown';
  };

  // ─── Recording Phase ──────────────────────────────────────────────────
  if (phase === 'recording') {
    return (
      <div className="fixed inset-0 bg-black flex flex-col" style={{ zIndex: 999999 }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoCaptured}
        />

        {/* Command flash overlay */}
        {commandFlash && (
          <div className="absolute inset-x-0 top-24 flex justify-center z-50 pointer-events-none">
            <div className="px-6 py-3 rounded-2xl bg-white/15 backdrop-blur-xl border border-white/20 text-white text-xl font-bold shadow-2xl animate-pulse">
              {commandFlash === 'Photo' && <Camera className="w-6 h-6 inline mr-2" />}
              {commandFlash === 'Next' && <ChevronRight className="w-6 h-6 inline mr-2" />}
              {commandFlash === 'Skip' && <ChevronRight className="w-6 h-6 inline mr-2" />}
              {commandFlash === 'Back' && <ChevronLeft className="w-6 h-6 inline mr-2" />}
              {commandFlash === 'Done' && <CheckCircle className="w-6 h-6 inline mr-2" />}
              {commandFlash}
            </div>
          </div>
        )}

        {/* Header bar - glassmorphism */}
        <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between bg-white/5 backdrop-blur-md border-b border-white/10">
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
            {photos.length > 0 && (
              <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 text-white/50 text-xs">
                <Image className="w-3 h-3" />
                {photos.length}
              </span>
            )}
            {listening ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 backdrop-blur-sm border border-red-500/30 rounded-full">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-400 text-xs font-semibold tracking-wide">LIVE</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/20 backdrop-blur-sm border border-yellow-500/30 rounded-full">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-yellow-400 text-xs font-semibold tracking-wide">PAUSED</span>
              </span>
            )}
          </div>
        </div>

        {/* Current field indicator - glassmorphism card */}
        <div className="flex-shrink-0 mx-4 mt-3 rounded-2xl bg-white/[0.07] backdrop-blur-lg border border-white/15 p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-white/40 text-xs uppercase tracking-widest font-medium">Current Field</p>
              <p className="text-white text-2xl font-bold mt-1 truncate">
                {currentField?.name ?? 'All fields completed'}
              </p>
              {currentField?.description && (
                <p className="text-white/40 text-sm mt-1">{currentField.description}</p>
              )}
              {/* Voice keywords */}
              {currentField?.voice_keywords && currentField.voice_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {currentField.voice_keywords.map((kw, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[10px] font-medium">
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="text-right ml-3 flex-shrink-0">
              <p className="text-white/30 text-sm font-medium">
                {currentFieldIdx + 1}<span className="text-white/15">/{voiceFields.length}</span>
              </p>
              {/* Field progress dots */}
              <div className="flex items-center gap-1 mt-2 justify-end">
                {voiceFields.map((f, i) => {
                  const fd = fieldData[f.id];
                  const hasData = fd && fd.value !== null && fd.value !== '' && fd.value !== undefined;
                  return (
                    <button
                      key={f.id}
                      onClick={() => goToField(i)}
                      className={`rounded-full transition-all duration-200 ${
                        i === currentFieldIdx
                          ? 'w-4 h-3 bg-white'
                          : hasData
                            ? 'w-2.5 h-2.5 bg-green-500'
                            : 'w-2.5 h-2.5 bg-white/20 hover:bg-white/30'
                      }`}
                      title={f.name}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Current field value preview */}
          {currentField && fieldData[currentField.id]?.value != null && fieldData[currentField.id]?.value !== '' && (
            <div className="mt-3 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
              <p className="text-white/70 text-sm leading-relaxed">
                {String(fieldData[currentField.id].value)}
              </p>
            </div>
          )}
        </div>

        {/* Transcript area - scrolling */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {transcript.length === 0 && !interimText && (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-20 h-20 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center mb-4">
                <Volume2 className="w-10 h-10 text-white/20" />
              </div>
              <p className="text-white/50 text-xl font-medium">Start speaking...</p>
              <p className="text-white/25 text-sm mt-2 leading-relaxed">
                Your voice will be transcribed in real time.{'\n'}
                Say "take a photo", "next", "skip", or "done".
              </p>
            </div>
          )}
          {transcript.map((entry, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-white/20 text-xs font-mono mt-1.5 flex-shrink-0 w-16 tabular-nums">
                {formatTime(entry.timestamp)}
              </span>
              <p className="text-white/90 text-lg leading-relaxed">
                {entry.text}
              </p>
            </div>
          ))}
          {interimText && (
            <div className="flex items-start gap-3">
              <span className="text-white/20 text-xs font-mono mt-1.5 flex-shrink-0 w-16 tabular-nums">
                {formatTime(Date.now())}
              </span>
              <p className="text-white/35 text-lg leading-relaxed italic">
                {interimText}
              </p>
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Voice commands hint bar */}
        <div className="flex-shrink-0 px-4 py-2 bg-white/[0.03] border-t border-white/10 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-2 text-xs text-white/30 whitespace-nowrap">
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-medium">"snap a pic"</span>
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-medium">"next"</span>
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-medium">"go back"</span>
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-medium">"skip"</span>
            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 font-medium">"done"</span>
          </div>
        </div>

        {/* Bottom action bar - glassmorphism */}
        <div className="flex-shrink-0 px-4 py-4 bg-white/[0.03] backdrop-blur-md border-t border-white/10">
          <div className="flex items-center justify-between gap-3">
            {/* Mic toggle */}
            <button
              onClick={() => { listening ? stopRecognition() : startRecognition(); }}
              className={`p-4 min-w-[44px] min-h-[44px] rounded-full transition-all duration-200 ${
                listening
                  ? 'bg-red-500 text-white shadow-lg shadow-red-500/40 ring-4 ring-red-500/20'
                  : 'bg-white/10 text-white/60 hover:bg-white/20 border border-white/10'
              }`}
            >
              {listening ? <Mic className="w-7 h-7" /> : <MicOff className="w-7 h-7" />}
            </button>

            {/* Camera button */}
            <button
              onClick={triggerPhotoCapture}
              className="p-4 min-w-[44px] min-h-[44px] rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/40 hover:bg-blue-500 transition-all duration-200 ring-4 ring-blue-600/20"
            >
              <Camera className="w-7 h-7" />
            </button>

            {/* Navigation */}
            <div className="flex items-center gap-2">
              <button
                onClick={goBack}
                disabled={currentFieldIdx <= 0}
                className="p-3 min-w-[44px] min-h-[44px] rounded-full bg-white/10 text-white/60 hover:bg-white/20 transition-colors disabled:opacity-20 disabled:cursor-not-allowed border border-white/10"
                title="Previous field"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={advanceField}
                disabled={currentFieldIdx >= voiceFields.length - 1}
                className="p-3 min-w-[44px] min-h-[44px] rounded-full bg-white/10 text-white/60 hover:bg-white/20 transition-colors disabled:opacity-20 disabled:cursor-not-allowed border border-white/10"
                title="Next field"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button
                onClick={finishRecording}
                className="px-5 py-3 min-h-[44px] rounded-full bg-green-600 text-white font-bold text-sm hover:bg-green-500 transition-all duration-200 shadow-lg shadow-green-600/30"
              >
                Done
              </button>
            </div>
          </div>

          {micError && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-red-500/15 backdrop-blur-sm border border-red-500/30 rounded-xl">
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
    <div className="fixed inset-0 bg-black flex flex-col" style={{ zIndex: 999999 }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between bg-white/5 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setPhase('recording'); startRecognition(); }}
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

      {/* Summary stats */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center gap-3 border-b border-white/5">
        <div className="flex-1 text-center">
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Fields</p>
          <p className="text-white font-bold text-lg">
            {voiceFields.filter(f => {
              const fd = fieldData[f.id];
              return fd && fd.value !== null && fd.value !== '' && fd.value !== undefined;
            }).length}
            <span className="text-white/20 font-normal">/{voiceFields.length}</span>
          </p>
        </div>
        <div className="w-px h-8 bg-white/10" />
        <div className="flex-1 text-center">
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Photos</p>
          <p className="text-white font-bold text-lg">{photos.length}</p>
        </div>
        <div className="w-px h-8 bg-white/10" />
        <div className="flex-1 text-center">
          <p className="text-white/30 text-[10px] uppercase tracking-wider">Transcript</p>
          <p className="text-white font-bold text-lg">{transcript.length}<span className="text-white/20 font-normal text-sm"> lines</span></p>
        </div>
      </div>

      {/* Scrollable review content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {voiceFields.map((field) => {
          const fd = fieldData[field.id];
          const value = fd?.value;
          const fieldPhotos = photos.filter(p => p.fieldId === field.id);
          const hasValue = value !== null && value !== '' && value !== undefined;
          const hasPhotos = fieldPhotos.length > 0;
          const isEditing = editingFieldValue === field.id;

          return (
            <div
              key={field.id}
              className={`rounded-2xl border p-4 transition-all duration-200 ${
                hasValue || hasPhotos
                  ? 'bg-white/[0.06] backdrop-blur-sm border-white/15'
                  : 'bg-white/[0.02] border-white/[0.08]'
              }`}
            >
              {/* Field header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-white font-semibold text-sm">{field.name}</h3>
                  {field.required && <span className="text-red-400 text-[10px] font-medium uppercase tracking-wider">Required</span>}
                  <span className="text-white/20 text-[10px]">{field.field_type}</span>
                </div>
                <div className="flex items-center gap-1">
                  {hasValue && <CheckCircle className="w-4 h-4 text-green-400" />}
                  {!isEditing && (
                    <button
                      onClick={() => {
                        setEditingFieldValue(field.id);
                        setEditingFieldText(
                          value != null ? (typeof value === 'object' ? JSON.stringify(value) : String(value)) : ''
                        );
                      }}
                      className="p-1 text-white/20 hover:text-white/50 transition-colors"
                      title="Edit value"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Value - editable */}
              {isEditing ? (
                <div className="mb-2 space-y-2">
                  {field.field_type === 'checkbox' ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={value === true || editingFieldText === 'true'}
                        onChange={(e) => {
                          updateFieldValue(field.id, e.target.checked);
                          setEditingFieldValue(null);
                        }}
                        className="w-5 h-5 rounded border-white/30 bg-white/10 text-green-500"
                      />
                      <span className="text-white/70 text-sm">{value ? 'Yes' : 'No'}</span>
                    </label>
                  ) : field.field_type === 'select' ? (
                    <select
                      value={(value as string) || ''}
                      onChange={(e) => {
                        updateFieldValue(field.id, e.target.value);
                        setEditingFieldValue(null);
                      }}
                      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-white text-sm"
                    >
                      <option value="">Select...</option>
                      {(Array.isArray(field.options) ? field.options : []).map((opt: string) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : field.field_type === 'rating' ? (
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => {
                            updateFieldValue(field.id, star);
                            setEditingFieldValue(null);
                          }}
                          className="p-0.5"
                        >
                          <span className={`text-2xl ${
                            star <= (typeof value === 'number' ? value : 0)
                              ? 'text-yellow-400'
                              : 'text-white/20'
                          }`}>
                            ★
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type={field.field_type === 'number' ? 'number' : 'text'}
                        value={editingFieldText}
                        onChange={(e) => setEditingFieldText(e.target.value)}
                        className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-xl text-white text-sm focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40 outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const v = field.field_type === 'number' ? parseFloat(editingFieldText) || null : editingFieldText;
                            updateFieldValue(field.id, v);
                            setEditingFieldValue(null);
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const v = field.field_type === 'number' ? parseFloat(editingFieldText) || null : editingFieldText;
                          updateFieldValue(field.id, v);
                          setEditingFieldValue(null);
                        }}
                        className="p-2 text-green-400 hover:text-green-300"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingFieldValue(null)}
                        className="p-2 text-white/30 hover:text-white/50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ) : hasValue ? (
                <div className="mb-2">
                  {field.field_type === 'checkbox' ? (
                    <span className={`text-sm font-medium ${value ? 'text-green-400' : 'text-red-400'}`}>
                      {value ? 'Yes' : 'No'}
                    </span>
                  ) : field.field_type === 'rating' ? (
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <span key={star} className={`text-lg ${star <= (typeof value === 'number' ? value : 0) ? 'text-yellow-400' : 'text-white/15'}`}>★</span>
                      ))}
                      <span className="text-white/40 text-xs ml-1">{value}/5</span>
                    </div>
                  ) : Array.isArray(value) ? (
                    <div className="flex flex-wrap gap-1">
                      {(value as string[]).map((v, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs">{v}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-white/80 text-sm bg-white/5 rounded-xl px-3 py-2 leading-relaxed">
                      {String(value)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-white/25 text-sm italic mb-2">No data captured</p>
              )}

              {/* Voice transcript for this field */}
              {fd?.voiceTranscript && (
                <div className="mb-2">
                  <p className="text-white/25 text-[10px] uppercase tracking-wider mb-0.5">Voice transcript</p>
                  <p className="text-white/40 text-xs italic leading-relaxed">{fd.voiceTranscript}</p>
                </div>
              )}

              {/* Photos for this field */}
              {hasPhotos && (
                <div className="space-y-2 mt-2 pt-2 border-t border-white/5">
                  <p className="text-white/30 text-xs">{fieldPhotos.length} photo{fieldPhotos.length !== 1 ? 's' : ''}</p>
                  <div className="flex flex-wrap gap-2">
                    {fieldPhotos.map(photo => (
                      <div key={photo.id} className="relative group">
                        <img
                          src={photo.dataUrl}
                          alt={photo.caption || 'Captured'}
                          className="w-20 h-20 object-cover rounded-xl border border-white/15"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 rounded-xl flex items-center justify-center gap-1 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingPhoto(photo.id);
                              setEditingCaption(photo.caption);
                            }}
                            className="p-1.5 rounded-lg bg-white/20 text-white"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deletePhoto(photo.id)}
                            className="p-1.5 rounded-lg bg-red-500/60 text-white"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        {/* Inline caption editing */}
                        {editingPhoto === photo.id && (
                          <div className="absolute -bottom-10 left-0 right-0 z-10 flex items-center gap-1">
                            <input
                              type="text"
                              value={editingCaption}
                              onChange={(e) => setEditingCaption(e.target.value)}
                              className="flex-1 px-2 py-1 bg-gray-900 border border-white/20 rounded text-white text-[10px] min-w-0"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  updatePhotoCaption(photo.id, editingCaption);
                                  setEditingPhoto(null);
                                }
                              }}
                            />
                            <button
                              onClick={() => { updatePhotoCaption(photo.id, editingCaption); setEditingPhoto(null); }}
                              className="p-0.5 text-green-400"
                            >
                              <CheckCircle className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        {photo.caption && editingPhoto !== photo.id && (
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
            <div className="rounded-2xl border border-yellow-500/25 bg-yellow-500/[0.06] backdrop-blur-sm p-4">
              <h3 className="text-yellow-400 font-semibold text-sm mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Unassigned Photos ({unassigned.length})
              </h3>
              <p className="text-white/35 text-xs mb-3">Assign these to a field or delete them.</p>
              <div className="space-y-3">
                {unassigned.map(photo => (
                  <div key={photo.id} className="flex items-start gap-3 bg-white/[0.03] rounded-xl p-2">
                    <img
                      src={photo.dataUrl}
                      alt={photo.caption || 'Captured'}
                      className="w-16 h-16 object-cover rounded-lg border border-white/15 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* Caption */}
                      {editingPhoto === photo.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editingCaption}
                            onChange={(e) => setEditingCaption(e.target.value)}
                            className="flex-1 px-2 py-1 bg-white/10 border border-white/20 rounded-lg text-white text-xs min-w-0"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                updatePhotoCaption(photo.id, editingCaption);
                                setEditingPhoto(null);
                              }
                            }}
                          />
                          <button
                            onClick={() => { updatePhotoCaption(photo.id, editingCaption); setEditingPhoto(null); }}
                            className="p-1 text-green-400"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <p className="text-white/50 text-xs truncate">{photo.caption || 'No caption'}</p>
                          <button
                            onClick={() => { setEditingPhoto(photo.id); setEditingCaption(photo.caption); }}
                            className="p-0.5 text-white/25 hover:text-white/50"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Reassign */}
                      <div className="relative">
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) reassignPhoto(photo.id, e.target.value); }}
                          className="w-full px-2 py-1.5 bg-white/10 border border-white/15 rounded-lg text-white text-xs appearance-none pr-6"
                        >
                          <option value="">Assign to field...</option>
                          {voiceFields.filter(f => f.photo_capture_enabled).map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                          {/* Also show all fields as fallback */}
                          {voiceFields.filter(f => !f.photo_capture_enabled).length > 0 && (
                            <option disabled>── Other fields ──</option>
                          )}
                          {voiceFields.filter(f => !f.photo_capture_enabled).map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1.5 top-2 w-3 h-3 text-white/30 pointer-events-none" />
                      </div>

                      <button
                        onClick={() => deletePhoto(photo.id)}
                        className="flex items-center gap-1 text-red-400/50 hover:text-red-400 text-xs transition-colors"
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
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-4">
            <h3 className="text-white/50 font-semibold text-sm mb-3 flex items-center gap-2">
              <Image className="w-4 h-4" />
              All Photos ({photos.length})
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {photos.map(photo => (
                <div key={photo.id} className="relative">
                  <img
                    src={photo.dataUrl}
                    alt={photo.caption || 'Captured'}
                    className="w-full aspect-square object-cover rounded-xl border border-white/10"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 rounded-b-xl">
                    <p className="text-white/80 text-[10px] truncate font-medium">
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
      <div className="flex-shrink-0 px-4 py-4 border-t border-white/10 bg-white/[0.03] backdrop-blur-md">
        {saveError && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-500/15 backdrop-blur-sm border border-red-500/30 rounded-xl">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-red-300 text-xs">{saveError}</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 text-sm font-medium text-white/50 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold rounded-2xl transition-all duration-200 ${
              saved
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/30'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Saving...</>
            ) : saved ? (
              <><CheckCircle className="w-4 h-4" />Saved</>
            ) : (
              <><Save className="w-4 h-4" />Save Survey</>
            )}
          </button>
        </div>

        {saved && (
          <button
            onClick={onClose}
            className="mt-3 w-full px-4 py-2.5 text-sm text-white/50 hover:text-white/80 transition-colors text-center rounded-xl"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
