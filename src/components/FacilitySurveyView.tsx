import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, CheckCircle, X, Camera, MapPin, Star, Loader2, Trash2, ChevronDown, ClipboardList, Mic } from 'lucide-react';
import { supabase, Facility, SurveyType, SurveyField, FacilitySurveyData } from '../lib/supabase';
import HandsFreeMode from './HandsFreeMode';

interface FacilitySurveyViewProps {
  facility: Facility;
  surveyType: SurveyType;
  fields: SurveyField[];
  existingData: FacilitySurveyData[];
  userId: string;
  onClose: () => void;
  onSaved?: () => void;
}

type FieldValue = string | number | boolean | string[] | null;

interface FieldState {
  [fieldId: string]: FieldValue;
}

export default function FacilitySurveyView({
  facility,
  surveyType,
  fields,
  existingData,
  userId,
  onClose,
  onSaved,
}: FacilitySurveyViewProps) {
  const [values, setValues] = useState<FieldState>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHandsFree, setShowHandsFree] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [activeSignatureField, setActiveSignatureField] = useState<string | null>(null);

  // Initialize values from existing data
  useEffect(() => {
    const initial: FieldState = {};
    for (const field of fields) {
      const existing = existingData.find(d => d.field_id === field.id);
      if (existing && existing.value !== null) {
        initial[field.id] = existing.value;
      } else {
        // Set default values based on field type
        switch (field.field_type) {
          case 'checkbox':
            initial[field.id] = false;
            break;
          case 'multi_select':
            initial[field.id] = [];
            break;
          case 'rating':
            initial[field.id] = 0;
            break;
          default:
            initial[field.id] = '';
        }
      }
    }
    setValues(initial);
  }, [fields, existingData]);

  const updateField = useCallback((fieldId: string, value: FieldValue) => {
    setValues(prev => ({ ...prev, [fieldId]: value }));
    setSaved(false);
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      // Validate required fields
      const missingRequired = fields.filter(f => {
        if (!f.required) return false;
        const val = values[f.id];
        if (val === null || val === undefined || val === '') return true;
        if (Array.isArray(val) && val.length === 0) return true;
        return false;
      });

      if (missingRequired.length > 0) {
        setError(`Required fields missing: ${missingRequired.map(f => f.name).join(', ')}`);
        setSaving(false);
        return;
      }

      // Upsert each field value
      const upserts = fields.map(field => ({
        facility_id: facility.id,
        survey_type_id: surveyType.id,
        field_id: field.id,
        value: values[field.id] ?? null,
        completed_by: userId,
        completed_at: new Date().toISOString(),
      }));

      for (const upsert of upserts) {
        // Check if record exists
        const existing = existingData.find(
          d => d.field_id === upsert.field_id
        );

        if (existing) {
          const { error: updateError } = await supabase
            .from('facility_survey_data')
            .update({
              value: upsert.value,
              completed_by: upsert.completed_by,
              completed_at: upsert.completed_at,
            })
            .eq('id', existing.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from('facility_survey_data')
            .insert(upsert);
          if (insertError) throw insertError;
        }
      }

      setSaved(true);
      if (onSaved) onSaved();
    } catch (err: any) {
      console.error('[FacilitySurveyView] Save error:', err);
      setError(err.message || 'Failed to save survey data');
    } finally {
      setSaving(false);
    }
  };

  // Signature drawing handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = 'touches' in e
      ? { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
      : { x: e.clientX - rect.left, y: e.clientY - rect.top };
    lastPointRef.current = point;
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const point = 'touches' in e
      ? { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
      : { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    lastPointRef.current = point;
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
    if (activeSignatureField && canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL();
      updateField(activeSignatureField, dataUrl);
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (activeSignatureField) {
      updateField(activeSignatureField, '');
    }
  };

  const completedCount = fields.filter(f => {
    const val = values[f.id];
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    if (val === false && f.field_type === 'checkbox') return false;
    if (val === 0 && f.field_type === 'rating') return false;
    return true;
  }).length;

  const renderField = (field: SurveyField) => {
    const value = values[field.id];
    const fieldId = `field-${field.id}`;

    switch (field.field_type) {
      case 'text':
        return (
          <input
            id={fieldId}
            type="text"
            value={(value as string) || ''}
            onChange={(e) => updateField(field.id, e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
            placeholder={field.description || `Enter ${field.name}...`}
          />
        );

      case 'textarea':
        return (
          <textarea
            id={fieldId}
            value={(value as string) || ''}
            onChange={(e) => updateField(field.id, e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors resize-y"
            placeholder={field.description || `Enter ${field.name}...`}
          />
        );

      case 'number':
        return (
          <input
            id={fieldId}
            type="number"
            value={value === '' || value === null || value === undefined ? '' : String(value)}
            onChange={(e) => updateField(field.id, e.target.value === '' ? '' : Number(e.target.value))}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
            placeholder={field.description || '0'}
          />
        );

      case 'date':
        return (
          <input
            id={fieldId}
            type="date"
            value={(value as string) || ''}
            onChange={(e) => updateField(field.id, e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
          />
        );

      case 'datetime':
        return (
          <input
            id={fieldId}
            type="datetime-local"
            value={(value as string) || ''}
            onChange={(e) => updateField(field.id, e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
          />
        );

      case 'select': {
        const options: string[] = Array.isArray(field.options) ? field.options : [];
        return (
          <div className="relative">
            <select
              id={fieldId}
              value={(value as string) || ''}
              onChange={(e) => updateField(field.id, e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors appearance-none pr-8"
            >
              <option value="">Select...</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        );
      }

      case 'multi_select': {
        const options: string[] = Array.isArray(field.options) ? field.options : [];
        const selected = Array.isArray(value) ? value as string[] : [];
        return (
          <div className="space-y-1.5">
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      updateField(field.id, [...selected, opt]);
                    } else {
                      updateField(field.id, selected.filter(s => s !== opt));
                    }
                  }}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{opt}</span>
              </label>
            ))}
          </div>
        );
      }

      case 'checkbox':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              id={fieldId}
              type="checkbox"
              checked={!!value}
              onChange={(e) => updateField(field.id, e.target.checked)}
              className="w-5 h-5 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {field.description || 'Yes'}
            </span>
          </label>
        );

      case 'photo':
        return (
          <div className="space-y-2">
            {value && typeof value === 'string' && value.startsWith('data:') && (
              <div className="relative inline-block">
                <img src={value} alt="Captured" className="max-h-32 rounded-lg border border-gray-200 dark:border-gray-600" />
                <button
                  onClick={() => updateField(field.id, '')}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-sm hover:bg-red-600"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}
            <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium w-fit">
              <Camera className="w-4 h-4" />
              {value ? 'Replace Photo' : 'Take Photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      updateField(field.id, reader.result as string);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </label>
          </div>
        );

      case 'signature':
        return (
          <div className="space-y-2">
            {value && typeof value === 'string' && value.startsWith('data:') && activeSignatureField !== field.id && (
              <div className="relative inline-block">
                <img src={value} alt="Signature" className="max-h-20 rounded border border-gray-200 dark:border-gray-600 bg-white" />
                <button
                  onClick={() => {
                    updateField(field.id, '');
                    setActiveSignatureField(field.id);
                  }}
                  className="ml-2 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  Re-sign
                </button>
              </div>
            )}
            {(!value || activeSignatureField === field.id) && (
              <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white">
                <canvas
                  ref={activeSignatureField === field.id ? canvasRef : undefined}
                  width={320}
                  height={100}
                  className="w-full cursor-crosshair touch-none"
                  onMouseDown={activeSignatureField === field.id ? startDrawing : () => setActiveSignatureField(field.id)}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={(e) => {
                    if (activeSignatureField !== field.id) {
                      setActiveSignatureField(field.id);
                    } else {
                      e.preventDefault();
                      startDrawing(e);
                    }
                  }}
                  onTouchMove={(e) => { e.preventDefault(); draw(e); }}
                  onTouchEnd={stopDrawing}
                />
                <div className="flex items-center justify-between px-2 py-1 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600">
                  <span className="text-[10px] text-gray-400">Sign above</span>
                  <button
                    onClick={clearSignature}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      case 'location':
        return (
          <div className="space-y-2">
            {value && typeof value === 'string' && value.includes(',') && (
              <div className="text-sm text-gray-700 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded-lg">
                {value}
              </div>
            )}
            <button
              onClick={() => {
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      updateField(field.id, `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`);
                    },
                    (err) => {
                      console.error('Location error:', err);
                      setError('Could not get location: ' + err.message);
                    },
                    { enableHighAccuracy: true, timeout: 10000 }
                  );
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors text-sm font-medium"
            >
              <MapPin className="w-4 h-4" />
              {value ? 'Update Location' : 'Capture Location'}
            </button>
          </div>
        );

      case 'rating': {
        const rating = typeof value === 'number' ? value : 0;
        return (
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => updateField(field.id, star === rating ? 0 : star)}
                className="p-0.5 transition-colors"
              >
                <Star
                  className={`w-7 h-7 ${
                    star <= rating
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-gray-300 dark:text-gray-600'
                  }`}
                />
              </button>
            ))}
            {rating > 0 && (
              <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">{rating}/5</span>
            )}
          </div>
        );
      }

      default:
        return (
          <input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => updateField(field.id, e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
          />
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center overflow-y-auto p-4" style={{ zIndex: 999999 }} onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg my-4 transition-colors" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 rounded-t-xl z-10 px-4 py-3 text-white" style={{ backgroundColor: surveyType.color }}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold truncate">{facility.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm opacity-90">{surveyType.name}</span>
                <span className="text-xs opacity-75">
                  {completedCount}/{fields.length} fields
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {surveyType.hands_free_enabled && (
                <button
                  onClick={() => setShowHandsFree(true)}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors"
                  title="Hands-Free Mode"
                >
                  <Mic className="w-5 h-5" />
                </button>
              )}
              <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/80 rounded-full transition-all duration-300"
              style={{ width: `${fields.length > 0 ? (completedCount / fields.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Fields */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {fields.length === 0 ? (
            <div className="text-center py-8">
              <ClipboardList className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No fields configured for this survey type.</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Add fields in Settings → Survey Types.</p>
            </div>
          ) : (
            fields.map((field) => (
              <div key={field.id} className="space-y-1.5">
                <label htmlFor={`field-${field.id}`} className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {field.name}
                  {field.required && <span className="text-red-500">*</span>}
                  {values[field.id] !== null && values[field.id] !== undefined && values[field.id] !== '' &&
                    !(Array.isArray(values[field.id]) && (values[field.id] as string[]).length === 0) &&
                    values[field.id] !== false && values[field.id] !== 0 && (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  )}
                </label>
                {field.description && field.field_type !== 'checkbox' && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">{field.description}</p>
                )}
                {renderField(field)}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {fields.length > 0 && (
          <div className="sticky bottom-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 rounded-b-xl flex items-center justify-between gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 px-5 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                saved
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-blue-600 hover:bg-blue-700'
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
                  Save
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Hands-Free Mode overlay */}
      {showHandsFree && (
        <HandsFreeMode
          facility={facility}
          surveyType={surveyType}
          fields={fields}
          existingData={existingData}
          userId={userId}
          onClose={() => setShowHandsFree(false)}
          onSaved={() => {
            setShowHandsFree(false);
            if (onSaved) onSaved();
          }}
        />
      )}
    </div>
  );
}
