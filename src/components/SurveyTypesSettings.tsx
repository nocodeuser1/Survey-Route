import { useState, useEffect } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ChevronRight, Loader2, X, FileText, ClipboardCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SurveyType {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  is_system: boolean;
  enabled: boolean;
  hands_free_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  field_count?: number;
}

interface SurveyTypesSettingsProps {
  accountId: string;
}

export default function SurveyTypesSettings({ accountId }: SurveyTypesSettingsProps) {
  const [surveyTypes, setSurveyTypes] = useState<SurveyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingType, setEditingType] = useState<SurveyType | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIcon, setFormIcon] = useState('clipboard');
  const [formColor, setFormColor] = useState('#3B82F6');

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

      // Load survey types
      const { data: types, error: typesError } = await supabase
        .from('survey_types')
        .select('*')
        .eq('account_id', accountId)
        .order('sort_order', { ascending: true });

      if (typesError) throw typesError;

      // Load field counts
      if (types && types.length > 0) {
        const typeIds = types.map(t => t.id);
        const { data: fields, error: fieldsError } = await supabase
          .from('survey_fields')
          .select('survey_type_id')
          .in('survey_type_id', typeIds);

        if (!fieldsError && fields) {
          const counts: Record<string, number> = {};
          fields.forEach(f => {
            counts[f.survey_type_id] = (counts[f.survey_type_id] || 0) + 1;
          });
          types.forEach(t => {
            t.field_count = counts[t.id] || 0;
          });
        }
      }

      setSurveyTypes(types || []);
    } catch (err) {
      console.error('Error loading survey types:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleEnabled = async (type: SurveyType) => {
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
      alert('Failed to update survey type');
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

  const openEditModal = (type: SurveyType) => {
    setEditingType(type);
    setFormName(type.name);
    setFormDescription(type.description || '');
    setFormIcon(type.icon);
    setFormColor(type.color);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      alert('Please enter a name');
      return;
    }

    try {
      setSaving(true);

      if (editingType) {
        // Update
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
        // Insert
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
      await loadSurveyTypes();
    } catch (err) {
      console.error('Error saving survey type:', err);
      alert('Failed to save survey type');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (type: SurveyType) => {
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
    } catch (err) {
      console.error('Error deleting survey type:', err);
      alert('Failed to delete survey type');
    } finally {
      setDeleting(null);
    }
  };

  const getIconComponent = (iconName: string, color: string) => {
    const props = { className: 'w-5 h-5', style: { color } };
    switch (iconName) {
      case 'file-text': return <FileText {...props} />;
      case 'clipboard-check': return <ClipboardCheck {...props} />;
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
                flex items-center gap-4 p-4 rounded-xl border transition-all
                ${type.enabled
                  ? 'bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700'
                  : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200/50 dark:border-gray-800 opacity-60'
                }
                backdrop-blur-sm
              `}
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
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {type.field_count || 0} fields
                  {type.description && ` · ${type.description}`}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
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

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6">
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
                <div className="flex gap-2">
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
