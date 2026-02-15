import React, { useState, useEffect } from 'react';
import {
  ClipboardList, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  ChevronRight, ChevronLeft, ChevronUp, ChevronDown, Loader2, X,
  FileText, ClipboardCheck, Shield, HardHat, Droplets, Wrench, Flame,
  CheckCircle, AlertTriangle, Lock, GripVertical, Type, Hash, Calendar,
  List, CheckSquare, Camera, PenTool, MapPin, Star, AlignLeft, Clock,
  Mic, Headphones, Tags
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SurveyType, SurveyField } from '../lib/supabase';

interface SurveyTypeWithCount extends SurveyType {
  field_count?: number;
}

interface SurveyTypesSettingsProps {
  accountId: string;
}

const FIELD_TYPES: { value: SurveyField['field_type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & Time' },
  { value: 'select', label: 'Select (Single)' },
  { value: 'multi_select', label: 'Multi Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'photo', label: 'Photo' },
  { value: 'signature', label: 'Signature' },
  { value: 'location', label: 'Location' },
  { value: 'rating', label: 'Rating' },
];

function getFieldTypeIcon(fieldType: string) {
  const cls = 'w-4 h-4';
  switch (fieldType) {
    case 'text': return <Type className={cls} />;
    case 'textarea': return <AlignLeft className={cls} />;
    case 'number': return <Hash className={cls} />;
    case 'date': return <Calendar className={cls} />;
    case 'datetime': return <Clock className={cls} />;
    case 'select': return <List className={cls} />;
    case 'multi_select': return <List className={cls} />;
    case 'checkbox': return <CheckSquare className={cls} />;
    case 'photo': return <Camera className={cls} />;
    case 'signature': return <PenTool className={cls} />;
    case 'location': return <MapPin className={cls} />;
    case 'rating': return <Star className={cls} />;
    default: return <Type className={cls} />;
  }
}

export default function SurveyTypesSettings({ accountId }: SurveyTypesSettingsProps) {
  const [surveyTypes, setSurveyTypes] = useState<SurveyTypeWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingType, setEditingType] = useState<SurveyTypeWithCount | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state for survey types
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIcon, setFormIcon] = useState('clipboard');
  const [formColor, setFormColor] = useState('#3B82F6');

  // Fields drill-down state
  const [selectedType, setSelectedType] = useState<SurveyTypeWithCount | null>(null);
  const [fields, setFields] = useState<SurveyField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [showFieldModal, setShowFieldModal] = useState(false);
  const [editingField, setEditingField] = useState<SurveyField | null>(null);
  const [fieldSaving, setFieldSaving] = useState(false);
  const [fieldDeleting, setFieldDeleting] = useState<string | null>(null);
  const [reordering, setReordering] = useState<string | null>(null);

  // Field form state
  const [fieldFormName, setFieldFormName] = useState('');
  const [fieldFormDescription, setFieldFormDescription] = useState('');
  const [fieldFormType, setFieldFormType] = useState<SurveyField['field_type']>('text');
  const [fieldFormRequired, setFieldFormRequired] = useState(false);
  const [fieldFormOptions, setFieldFormOptions] = useState<string[]>([]);
  const [newOptionValue, setNewOptionValue] = useState('');

  const iconOptions = [
    { value: 'clipboard', label: 'Clipboard' },
    { value: 'file-text', label: 'Document' },
    { value: 'clipboard-check', label: 'Checklist' },
    { value: 'shield', label: 'Shield' },
    { value: 'hard-hat', label: 'Safety' },
    { value: 'droplets', label: 'Environmental' },
    { value: 'wrench', label: 'Maintenance' },
    { value: 'flame', label: 'Fire Safety' },
  ];

  const colorOptions = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#F97316',
  ];

  useEffect(() => {
    loadSurveyTypes();
  }, [accountId]);

  const loadSurveyTypes = async () => {
    try {
      setLoading(true);

      const { data: types, error: typesError } = await supabase
        .from('survey_types')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order', { ascending: true });

      if (typesError) throw typesError;

      if (types && types.length > 0) {
        const typeIds = types.map(t => t.id);
        const { data: fieldRows, error: fieldsError } = await supabase
          .from('survey_fields')
          .select('survey_type_id')
          .in('survey_type_id', typeIds);

        if (!fieldsError && fieldRows) {
          const counts: Record<string, number> = {};
          fieldRows.forEach(f => {
            counts[f.survey_type_id] = (counts[f.survey_type_id] || 0) + 1;
          });
          types.forEach(t => {
            (t as SurveyTypeWithCount).field_count = counts[t.id] || 0;
          });
        }
      }

      setSurveyTypes(types || []);

      // If we're viewing a type's fields, refresh the selected type data
      if (selectedType) {
        const updated = types?.find(t => t.id === selectedType.id);
        if (updated) setSelectedType(updated as SurveyTypeWithCount);
      }
    } catch (err) {
      console.error('Error loading survey types:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadFields = async (surveyTypeId: string) => {
    try {
      setFieldsLoading(true);
      const { data, error } = await supabase
        .from('survey_fields')
        .select('*')
        .eq('survey_type_id', surveyTypeId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setFields(data || []);
    } catch (err) {
      console.error('Error loading fields:', err);
      showMessage('error', 'Failed to load fields');
    } finally {
      setFieldsLoading(false);
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // ─── Survey Types CRUD ───

  const toggleEnabled = async (type: SurveyTypeWithCount) => {
    try {
      const { error } = await supabase
        .from('survey_types')
        .update({ enabled: !type.enabled })
        .eq('id', type.id);

      if (error) throw error;

      setSurveyTypes(prev =>
        prev.map(t => t.id === type.id ? { ...t, enabled: !t.enabled } : t)
      );
    } catch (err) {
      console.error('Error toggling survey type:', err);
      showMessage('error', 'Failed to update survey type');
    }
  };

  const openAddModal = () => {
    setEditingType(null);
    setFormName('');
    setFormDescription('');
    setFormIcon('clipboard');
    setFormColor('#3B82F6');
    setShowModal(true);
  };

  const openEditModal = (type: SurveyTypeWithCount) => {
    setEditingType(type);
    setFormName(type.name);
    setFormDescription(type.description || '');
    setFormIcon(type.icon);
    setFormColor(type.color);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      showMessage('error', 'Please enter a name');
      return;
    }

    try {
      setSaving(true);

      if (editingType) {
        const { error } = await supabase
          .from('survey_types')
          .update({
            name: formName.trim(),
            description: formDescription.trim() || null,
            icon: formIcon,
            color: formColor,
          })
          .eq('id', editingType.id);

        if (error) throw error;
      } else {
        const maxSort = surveyTypes.length > 0
          ? Math.max(...surveyTypes.map(t => t.sort_order))
          : -1;

        const { error } = await supabase
          .from('survey_types')
          .insert({
            account_id: accountId,
            name: formName.trim(),
            description: formDescription.trim() || null,
            icon: formIcon,
            color: formColor,
            is_system: false,
            enabled: true,
            sort_order: maxSort + 1,
          });

        if (error) throw error;
      }

      setShowModal(false);
      showMessage('success', editingType ? 'Survey type updated' : 'Survey type created');
      await loadSurveyTypes();
    } catch (err) {
      console.error('Error saving survey type:', err);
      showMessage('error', 'Failed to save survey type');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (type: SurveyTypeWithCount) => {
    if (type.is_system) return;

    if (!confirm(`Delete "${type.name}"? This will also delete all associated fields and data.`)) {
      return;
    }

    try {
      setDeleting(type.id);
      const { error } = await supabase
        .from('survey_types')
        .delete()
        .eq('id', type.id);

      if (error) throw error;

      setSurveyTypes(prev => prev.filter(t => t.id !== type.id));
      showMessage('success', `"${type.name}" deleted`);
    } catch (err) {
      console.error('Error deleting survey type:', err);
      showMessage('error', 'Failed to delete survey type');
    } finally {
      setDeleting(null);
    }
  };

  // ─── Fields CRUD ───

  const openFieldDrillDown = async (type: SurveyTypeWithCount) => {
    setSelectedType(type);
    await loadFields(type.id);
  };

  const closeFieldDrillDown = () => {
    setSelectedType(null);
    setFields([]);
    // Refresh counts
    loadSurveyTypes();
  };

  const openAddFieldModal = () => {
    setEditingField(null);
    setFieldFormName('');
    setFieldFormDescription('');
    setFieldFormType('text');
    setFieldFormRequired(false);
    setFieldFormOptions([]);
    setNewOptionValue('');
    setShowFieldModal(true);
  };

  const openEditFieldModal = (field: SurveyField) => {
    if (field.is_system) return;
    setEditingField(field);
    setFieldFormName(field.name);
    setFieldFormDescription(field.description || '');
    setFieldFormType(field.field_type);
    setFieldFormRequired(field.required);
    setFieldFormOptions(
      Array.isArray(field.options) ? field.options : []
    );
    setNewOptionValue('');
    setShowFieldModal(true);
  };

  const handleFieldSave = async () => {
    if (!fieldFormName.trim() || !selectedType) {
      showMessage('error', 'Please enter a field name');
      return;
    }

    if ((fieldFormType === 'select' || fieldFormType === 'multi_select') && fieldFormOptions.length === 0) {
      showMessage('error', 'Please add at least one option for select fields');
      return;
    }

    try {
      setFieldSaving(true);

      const fieldData: Record<string, unknown> = {
        name: fieldFormName.trim(),
        description: fieldFormDescription.trim() || null,
        field_type: fieldFormType,
        required: fieldFormRequired,
        options: (fieldFormType === 'select' || fieldFormType === 'multi_select')
          ? fieldFormOptions
          : null,
      };

      if (editingField) {
        const { error } = await supabase
          .from('survey_fields')
          .update(fieldData)
          .eq('id', editingField.id);

        if (error) throw error;
      } else {
        const maxSort = fields.length > 0
          ? Math.max(...fields.map(f => f.sort_order))
          : 0;

        const { error } = await supabase
          .from('survey_fields')
          .insert({
            ...fieldData,
            survey_type_id: selectedType.id,
            is_system: false,
            sort_order: maxSort + 1,
          });

        if (error) throw error;
      }

      setShowFieldModal(false);
      showMessage('success', editingField ? 'Field updated' : 'Field created');
      await loadFields(selectedType.id);
      await loadSurveyTypes();
    } catch (err) {
      console.error('Error saving field:', err);
      showMessage('error', 'Failed to save field');
    } finally {
      setFieldSaving(false);
    }
  };

  const handleFieldDelete = async (field: SurveyField) => {
    if (field.is_system || !selectedType) return;

    if (!confirm(`Delete field "${field.name}"? Any data collected for this field will be lost.`)) {
      return;
    }

    try {
      setFieldDeleting(field.id);
      const { error } = await supabase
        .from('survey_fields')
        .delete()
        .eq('id', field.id);

      if (error) throw error;

      setFields(prev => prev.filter(f => f.id !== field.id));
      showMessage('success', `"${field.name}" deleted`);
      await loadSurveyTypes();
    } catch (err) {
      console.error('Error deleting field:', err);
      showMessage('error', 'Failed to delete field');
    } finally {
      setFieldDeleting(null);
    }
  };

  const moveField = async (field: SurveyField, direction: 'up' | 'down') => {
    const idx = fields.findIndex(f => f.id === field.id);
    if (direction === 'up' && idx <= 0) return;
    if (direction === 'down' && idx >= fields.length - 1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const other = fields[swapIdx];

    try {
      setReordering(field.id);

      // Swap sort_order values
      const [{ error: err1 }, { error: err2 }] = await Promise.all([
        supabase
          .from('survey_fields')
          .update({ sort_order: other.sort_order })
          .eq('id', field.id),
        supabase
          .from('survey_fields')
          .update({ sort_order: field.sort_order })
          .eq('id', other.id),
      ]);

      if (err1) throw err1;
      if (err2) throw err2;

      // Update local state
      const newFields = [...fields];
      const tempSort = newFields[idx].sort_order;
      newFields[idx] = { ...newFields[idx], sort_order: newFields[swapIdx].sort_order };
      newFields[swapIdx] = { ...newFields[swapIdx], sort_order: tempSort };
      newFields.sort((a, b) => a.sort_order - b.sort_order);
      setFields(newFields);
    } catch (err) {
      console.error('Error reordering field:', err);
      showMessage('error', 'Failed to reorder field');
    } finally {
      setReordering(null);
    }
  };

  const toggleFieldRequired = async (field: SurveyField) => {
    if (field.is_system) return;

    try {
      const { error } = await supabase
        .from('survey_fields')
        .update({ required: !field.required })
        .eq('id', field.id);

      if (error) throw error;

      setFields(prev =>
        prev.map(f => f.id === field.id ? { ...f, required: !f.required } : f)
      );
    } catch (err) {
      console.error('Error toggling field required:', err);
      showMessage('error', 'Failed to update field');
    }
  };

  // ─── Hands-Free toggles ───

  const toggleHandsFree = async (type: SurveyTypeWithCount) => {
    try {
      const newVal = !type.hands_free_enabled;
      const { error } = await supabase
        .from('survey_types')
        .update({ hands_free_enabled: newVal })
        .eq('id', type.id);

      if (error) throw error;

      setSelectedType(prev => prev ? { ...prev, hands_free_enabled: newVal } : prev);
      setSurveyTypes(prev =>
        prev.map(t => t.id === type.id ? { ...t, hands_free_enabled: newVal } : t)
      );
    } catch (err) {
      console.error('Error toggling hands-free:', err);
      showMessage('error', 'Failed to update hands-free setting');
    }
  };

  const toggleFieldVoice = async (field: SurveyField) => {
    try {
      const newVal = !field.voice_input_enabled;
      const { error } = await supabase
        .from('survey_fields')
        .update({ voice_input_enabled: newVal })
        .eq('id', field.id);

      if (error) throw error;

      setFields(prev =>
        prev.map(f => f.id === field.id ? { ...f, voice_input_enabled: newVal } : f)
      );
    } catch (err) {
      console.error('Error toggling voice input:', err);
      showMessage('error', 'Failed to update field');
    }
  };

  const toggleFieldPhoto = async (field: SurveyField) => {
    try {
      const newVal = !field.photo_capture_enabled;
      const { error } = await supabase
        .from('survey_fields')
        .update({ photo_capture_enabled: newVal })
        .eq('id', field.id);

      if (error) throw error;

      setFields(prev =>
        prev.map(f => f.id === field.id ? { ...f, photo_capture_enabled: newVal } : f)
      );
    } catch (err) {
      console.error('Error toggling photo capture:', err);
      showMessage('error', 'Failed to update field');
    }
  };

  const toggleAllVoice = async () => {
    if (fields.length === 0) return;
    const allEnabled = fields.every(f => f.voice_input_enabled);
    const newVal = !allEnabled;
    try {
      const ids = fields.map(f => f.id);
      const { error } = await supabase
        .from('survey_fields')
        .update({ voice_input_enabled: newVal })
        .in('id', ids);

      if (error) throw error;

      setFields(prev => prev.map(f => ({ ...f, voice_input_enabled: newVal })));
    } catch (err) {
      console.error('Error toggling all voice:', err);
      showMessage('error', 'Failed to update fields');
    }
  };

  const toggleAllPhoto = async () => {
    if (fields.length === 0) return;
    const allEnabled = fields.every(f => f.photo_capture_enabled);
    const newVal = !allEnabled;
    try {
      const ids = fields.map(f => f.id);
      const { error } = await supabase
        .from('survey_fields')
        .update({ photo_capture_enabled: newVal })
        .in('id', ids);

      if (error) throw error;

      setFields(prev => prev.map(f => ({ ...f, photo_capture_enabled: newVal })));
    } catch (err) {
      console.error('Error toggling all photo:', err);
      showMessage('error', 'Failed to update fields');
    }
  };

  const toggleAll = async () => {
    if (fields.length === 0) return;
    const allEnabled = fields.every(f => f.voice_input_enabled && f.photo_capture_enabled);
    const newVal = !allEnabled;
    try {
      const ids = fields.map(f => f.id);
      const { error } = await supabase
        .from('survey_fields')
        .update({ voice_input_enabled: newVal, photo_capture_enabled: newVal })
        .in('id', ids);

      if (error) throw error;

      setFields(prev => prev.map(f => ({ ...f, voice_input_enabled: newVal, photo_capture_enabled: newVal })));
    } catch (err) {
      console.error('Error toggling all:', err);
      showMessage('error', 'Failed to update fields');
    }
  };

  const [editingKeywords, setEditingKeywords] = useState<string | null>(null);
  const [keywordsInput, setKeywordsInput] = useState('');

  const startEditKeywords = (field: SurveyField) => {
    setEditingKeywords(field.id);
    setKeywordsInput((field.voice_keywords || []).join(', '));
  };

  const saveKeywords = async (field: SurveyField) => {
    try {
      const keywords = keywordsInput
        .split(',')
        .map(k => k.trim())
        .filter(k => k.length > 0);

      const { error } = await supabase
        .from('survey_fields')
        .update({ voice_keywords: keywords.length > 0 ? keywords : null })
        .eq('id', field.id);

      if (error) throw error;

      setFields(prev =>
        prev.map(f => f.id === field.id ? { ...f, voice_keywords: keywords.length > 0 ? keywords : null } : f)
      );
      setEditingKeywords(null);
    } catch (err) {
      console.error('Error saving voice keywords:', err);
      showMessage('error', 'Failed to save keywords');
    }
  };

  // ─── Options management for select/multi_select ───

  const addOption = () => {
    const val = newOptionValue.trim();
    if (!val) return;
    if (fieldFormOptions.includes(val)) {
      showMessage('error', 'Option already exists');
      return;
    }
    setFieldFormOptions(prev => [...prev, val]);
    setNewOptionValue('');
  };

  const removeOption = (idx: number) => {
    setFieldFormOptions(prev => prev.filter((_, i) => i !== idx));
  };

  const moveOption = (idx: number, direction: 'up' | 'down') => {
    if (direction === 'up' && idx <= 0) return;
    if (direction === 'down' && idx >= fieldFormOptions.length - 1) return;
    const newOpts = [...fieldFormOptions];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newOpts[idx], newOpts[swapIdx]] = [newOpts[swapIdx], newOpts[idx]];
    setFieldFormOptions(newOpts);
  };

  // ─── Rendering helpers ───

  const getIconComponent = (iconName: string, color: string) => {
    const props = { className: 'w-5 h-5', style: { color } };
    switch (iconName) {
      case 'file-text': return <FileText {...props} />;
      case 'clipboard-check': return <ClipboardCheck {...props} />;
      case 'shield': return <Shield {...props} />;
      case 'hard-hat': return <HardHat {...props} />;
      case 'droplets': return <Droplets {...props} />;
      case 'wrench': return <Wrench {...props} />;
      case 'flame': return <Flame {...props} />;
      default: return <ClipboardList {...props} />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-500 dark:text-gray-400">Loading survey types...</span>
      </div>
    );
  }

  // ─── Fields drill-down view ───

  if (selectedType) {
    return (
      <div className="space-y-6">
        {/* Header with back button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={closeFieldDrillDown}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${selectedType.color}20` }}
            >
              {getIconComponent(selectedType.icon, selectedType.color)}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {selectedType.name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {fields.length} field{fields.length !== 1 ? 's' : ''}
                {selectedType.is_system && ' · System survey type'}
              </p>
            </div>
          </div>
          <button
            onClick={openAddFieldModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Field
          </button>
        </div>

        {/* Hands-Free Mode Toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl border bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-purple-100 dark:bg-purple-900/30">
              <Headphones className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h4 className="font-medium text-gray-900 dark:text-white">Hands-Free Mode</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Enable voice-guided survey data collection
              </p>
            </div>
          </div>
          <button
            onClick={() => selectedType && toggleHandsFree(selectedType)}
            className="p-1"
          >
            {selectedType?.hands_free_enabled ? (
              <ToggleRight className="w-10 h-6 text-green-500" />
            ) : (
              <ToggleLeft className="w-10 h-6 text-gray-400" />
            )}
          </button>
        </div>

        {/* Column Headers with Toggle All */}
        {fields.length > 0 && (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-[52px] flex-shrink-0" />
            <div className="w-8 flex-shrink-0" />
            <div className="flex-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Fields
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <span
                onClick={toggleAllVoice}
                className="flex items-center gap-1 w-[52px] justify-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="Click to toggle all voice"
              >
                <Mic className="w-3 h-3" />
                Voice
              </span>
              <span
                onClick={toggleAllPhoto}
                className="flex items-center gap-1 w-[52px] justify-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                title="Click to toggle all photo"
              >
                <Camera className="w-3 h-3" />
                Photo
              </span>
              <button
                onClick={toggleAll}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Toggle All
              </button>
            </div>
          </div>
        )}

        {/* Message */}
        {message && (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
          }`}>
            {message.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
            <p className="text-sm">{message.text}</p>
          </div>
        )}

        {/* Fields list */}
        {fieldsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            <span className="ml-2 text-gray-500 dark:text-gray-400">Loading fields...</span>
          </div>
        ) : fields.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
            <GripVertical className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-500 dark:text-gray-400">No fields configured</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Add fields to define what data this survey collects
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {fields.map((field, idx) => (
              <React.Fragment key={field.id}>
              <div
                className="flex items-center gap-3 p-3 rounded-xl border bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 backdrop-blur-sm group"
              >
                {/* Reorder buttons */}
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => moveField(field, 'up')}
                    disabled={idx === 0 || reordering !== null}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Move up"
                  >
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  </button>
                  <button
                    onClick={() => moveField(field, 'down')}
                    disabled={idx === fields.length - 1 || reordering !== null}
                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Move down"
                  >
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                {/* Field type icon */}
                <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                  {getFieldTypeIcon(field.field_type)}
                </div>

                {/* Field info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white truncate text-sm">
                      {field.name}
                    </span>
                    {field.is_system && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                        <Lock className="w-3 h-3" />
                        System
                      </span>
                    )}
                    {field.required && (
                      <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                        Required
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                      {field.field_type.replace('_', ' ')}
                    </span>
                    {field.description && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        · {field.description}
                      </span>
                    )}
                    {(field.field_type === 'select' || field.field_type === 'multi_select') && Array.isArray(field.options) && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        · {field.options.length} option{field.options.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Voice & Photo toggles */}
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="w-[52px] flex justify-center">
                    <button
                      onClick={() => toggleFieldVoice(field)}
                      className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-colors ${
                        field.voice_input_enabled
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                      }`}
                      title={field.voice_input_enabled ? 'Disable voice input' : 'Enable voice input'}
                    >
                      {field.voice_input_enabled && <Mic className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="w-[52px] flex justify-center">
                    <button
                      onClick={() => toggleFieldPhoto(field)}
                      className={`w-7 h-7 rounded-md border-2 flex items-center justify-center transition-colors ${
                        field.photo_capture_enabled
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                      }`}
                      title={field.photo_capture_enabled ? 'Disable photo capture' : 'Enable photo capture'}
                    >
                      {field.photo_capture_enabled && <Camera className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {/* Voice keywords */}
                  <button
                    onClick={() => startEditKeywords(field)}
                    className={`p-2 rounded-lg transition-colors ${
                      field.voice_keywords && field.voice_keywords.length > 0
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500'
                    }`}
                    title={`Voice keywords: ${field.voice_keywords?.join(', ') || 'none'}`}
                  >
                    <Tags className="w-4 h-4" />
                  </button>

                  {/* Required toggle */}
                  {!field.is_system && (
                    <button
                      onClick={() => toggleFieldRequired(field)}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        field.required
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                      title={field.required ? 'Make optional' : 'Make required'}
                    >
                      {field.required ? 'Req' : 'Opt'}
                    </button>
                  )}

                  {/* Edit */}
                  {!field.is_system && (
                    <button
                      onClick={() => openEditFieldModal(field)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      title="Edit field"
                    >
                      <Pencil className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                    </button>
                  )}

                  {/* Delete */}
                  {!field.is_system && (
                    <button
                      onClick={() => handleFieldDelete(field)}
                      disabled={fieldDeleting === field.id}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      title="Delete field"
                    >
                      {fieldDeleting === field.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                      ) : (
                        <Trash2 className="w-4 h-4 text-red-500" />
                      )}
                    </button>
                  )}

                  {/* System lock indicator */}
                  {field.is_system && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                      Locked
                    </span>
                  )}
                </div>
              </div>

              {/* Voice Keywords Editor (inline) */}
              {editingKeywords === field.id && (
                <div className="ml-[52px] mr-3 mb-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Voice Keywords (comma-separated)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={keywordsInput}
                      onChange={e => setKeywordsInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveKeywords(field); } }}
                      placeholder="e.g., containment, wall, secondary"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      autoFocus
                    />
                    <button
                      onClick={() => saveKeywords(field)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingKeywords(null)}
                      className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                  {keywordsInput && (
                    <div className="flex gap-1 flex-wrap mt-2">
                      {keywordsInput.split(',').map(k => k.trim()).filter(k => k).map((k, idx) => (
                        <span key={idx} className="px-2 py-0.5 text-xs rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
            ))}
          </div>
        )}

        {/* Add/Edit Field Modal */}
        {showFieldModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowFieldModal(false)} />
            <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {editingField ? 'Edit Field' : 'New Field'}
                </h3>
                <button
                  onClick={() => setShowFieldModal(false)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              {/* Form */}
              <div className="space-y-4">
                {/* Field Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Field Name *
                  </label>
                  <input
                    type="text"
                    value={fieldFormName}
                    onChange={e => setFieldFormName(e.target.value)}
                    placeholder="e.g., Tank Condition"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={fieldFormDescription}
                    onChange={e => setFieldFormDescription(e.target.value)}
                    placeholder="Brief description or help text"
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>

                {/* Field Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Field Type *
                  </label>
                  <select
                    value={fieldFormType}
                    onChange={e => setFieldFormType(e.target.value as SurveyField['field_type'])}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {FIELD_TYPES.map(ft => (
                      <option key={ft.value} value={ft.value}>{ft.label}</option>
                    ))}
                  </select>
                </div>

                {/* Required toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Required field
                  </label>
                  <button
                    onClick={() => setFieldFormRequired(!fieldFormRequired)}
                    className="p-1"
                  >
                    {fieldFormRequired ? (
                      <ToggleRight className="w-8 h-5 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-8 h-5 text-gray-400" />
                    )}
                  </button>
                </div>

                {/* Options editor for select/multi_select */}
                {(fieldFormType === 'select' || fieldFormType === 'multi_select') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Options *
                    </label>

                    {/* Existing options */}
                    {fieldFormOptions.length > 0 && (
                      <div className="space-y-1.5 mb-3">
                        {fieldFormOptions.map((opt, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
                            <div className="flex flex-col gap-0.5">
                              <button
                                onClick={() => moveOption(idx, 'up')}
                                disabled={idx === 0}
                                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <ChevronUp className="w-3 h-3 text-gray-400" />
                              </button>
                              <button
                                onClick={() => moveOption(idx, 'down')}
                                disabled={idx === fieldFormOptions.length - 1}
                                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <ChevronDown className="w-3 h-3 text-gray-400" />
                              </button>
                            </div>
                            <span className="flex-1 text-sm text-gray-900 dark:text-white">{opt}</span>
                            <button
                              onClick={() => removeOption(idx)}
                              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <X className="w-3.5 h-3.5 text-red-500" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add new option */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newOptionValue}
                        onChange={e => setNewOptionValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
                        placeholder="Type an option value"
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                      />
                      <button
                        onClick={addOption}
                        disabled={!newOptionValue.trim()}
                        className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setShowFieldModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFieldSave}
                  disabled={fieldSaving || !fieldFormName.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                >
                  {fieldSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingField ? 'Save Changes' : 'Create Field'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Survey Types list view ───

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Survey Types</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Manage survey types for facility inspections and data collection
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add Survey Type
        </button>
      </div>

      {/* Inline Message */}
      {message && (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      {/* Survey Types List */}
      <div className="space-y-3">
        {surveyTypes.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
            <ClipboardList className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-500 dark:text-gray-400">No survey types configured</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              Add a survey type to start collecting structured field data
            </p>
          </div>
        ) : (
          surveyTypes.map(type => (
            <div
              key={type.id}
              className={`
                flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer
                ${type.enabled
                  ? 'bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                  : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200/50 dark:border-gray-800 opacity-60'
                }
                backdrop-blur-sm
              `}
              onClick={() => openFieldDrillDown(type)}
            >
              {/* Icon */}
              <div
                className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${type.color}20` }}
              >
                {getIconComponent(type.icon, type.color)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-gray-900 dark:text-white truncate">
                    {type.name}
                  </h4>
                  {type.is_system && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                      System
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-medium">{type.field_count || 0}</span> field{(type.field_count || 0) !== 1 ? 's' : ''}
                  </span>
                  {' · Hands-free: '}
                  <span className={type.hands_free_enabled ? 'text-green-600 dark:text-green-400' : ''}>
                    {type.hands_free_enabled ? 'enabled' : 'disabled'}
                  </span>
                  {type.description && ` · ${type.description}`}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                {/* Enable/Disable Toggle */}
                <button
                  onClick={() => toggleEnabled(type)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title={type.enabled ? 'Disable' : 'Enable'}
                >
                  {type.enabled ? (
                    <ToggleRight className="w-6 h-6 text-green-500" />
                  ) : (
                    <ToggleLeft className="w-6 h-6 text-gray-400" />
                  )}
                </button>

                {/* Edit (custom only) */}
                {!type.is_system && (
                  <button
                    onClick={() => openEditModal(type)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </button>
                )}

                {/* Delete (custom only) */}
                {!type.is_system && (
                  <button
                    onClick={() => handleDelete(type)}
                    disabled={deleting === type.id}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="Delete"
                  >
                    {deleting === type.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                    ) : (
                      <Trash2 className="w-4 h-4 text-red-500" />
                    )}
                  </button>
                )}

                {/* Configure Fields Arrow */}
                <ChevronRight className="w-4 h-4 text-gray-400 ml-1" />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit Survey Type Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingType ? 'Edit Survey Type' : 'New Survey Type'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Form */}
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g., Tank Inspection"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Brief description of this survey type"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>

              {/* Color */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Color
                </label>
                <div className="flex gap-2 flex-wrap">
                  {colorOptions.map(color => (
                    <button
                      key={color}
                      onClick={() => setFormColor(color)}
                      className={`w-8 h-8 rounded-full transition-all ${
                        formColor === color
                          ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-blue-500 scale-110'
                          : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Icon */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Icon
                </label>
                <div className="flex gap-2 flex-wrap">
                  {iconOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setFormIcon(opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        formIcon === opt.value
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingType ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
