import { useState, useEffect, useCallback } from 'react';
import { supabase, SurveyType, SurveyField, FacilitySurveyData } from '../lib/supabase';

interface UseSurveyTypesResult {
  surveyTypes: SurveyType[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getFieldsForType: (surveyTypeId: string) => SurveyField[];
  getSurveyData: (facilityId: string, surveyTypeId: string) => FacilitySurveyData[];
  getCompletionStatus: (facilityId: string, surveyTypeId: string) => { completed: number; total: number; percent: number };
  allFields: Map<string, SurveyField[]>;
  allSurveyData: FacilitySurveyData[];
  refreshSurveyData: () => Promise<void>;
}

export function useSurveyTypes(accountId: string): UseSurveyTypesResult {
  const [surveyTypes, setSurveyTypes] = useState<SurveyType[]>([]);
  const [allFields, setAllFields] = useState<Map<string, SurveyField[]>>(new Map());
  const [allSurveyData, setAllSurveyData] = useState<FacilitySurveyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSurveyTypes = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      // Load enabled survey types
      const { data: types, error: typesError } = await supabase
        .from('survey_types')
        .select('*')
        .eq('account_id', accountId)
        .eq('enabled', true)
        .order('sort_order', { ascending: true });

      if (typesError) throw typesError;
      setSurveyTypes(types || []);

      // Load fields for all enabled types
      if (types && types.length > 0) {
        const typeIds = types.map(t => t.id);
        const { data: fields, error: fieldsError } = await supabase
          .from('survey_fields')
          .select('*')
          .in('survey_type_id', typeIds)
          .order('sort_order', { ascending: true });

        if (fieldsError) throw fieldsError;

        const fieldsMap = new Map<string, SurveyField[]>();
        for (const typeId of typeIds) {
          fieldsMap.set(typeId, (fields || []).filter(f => f.survey_type_id === typeId));
        }
        setAllFields(fieldsMap);
      } else {
        setAllFields(new Map());
      }
    } catch (err: any) {
      console.error('[useSurveyTypes] Error loading survey types:', err);
      setError(err.message || 'Failed to load survey types');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const loadSurveyData = useCallback(async () => {
    if (!accountId) return;
    try {
      const { data, error: dataError } = await supabase
        .from('facility_survey_data')
        .select('*');

      if (dataError) throw dataError;
      setAllSurveyData(data || []);
    } catch (err: any) {
      console.error('[useSurveyTypes] Error loading survey data:', err);
    }
  }, [accountId]);

  useEffect(() => {
    loadSurveyTypes();
    loadSurveyData();
  }, [loadSurveyTypes, loadSurveyData]);

  const getFieldsForType = useCallback((surveyTypeId: string): SurveyField[] => {
    return allFields.get(surveyTypeId) || [];
  }, [allFields]);

  const getSurveyData = useCallback((facilityId: string, surveyTypeId: string): FacilitySurveyData[] => {
    return allSurveyData.filter(d => d.facility_id === facilityId && d.survey_type_id === surveyTypeId);
  }, [allSurveyData]);

  const getCompletionStatus = useCallback((facilityId: string, surveyTypeId: string): { completed: number; total: number; percent: number } => {
    const fields = getFieldsForType(surveyTypeId);
    const data = getSurveyData(facilityId, surveyTypeId);
    const total = fields.length;
    if (total === 0) return { completed: 0, total: 0, percent: 0 };

    const filledFieldIds = new Set(
      data.filter(d => d.value !== null && d.value !== undefined && d.value !== '').map(d => d.field_id)
    );
    const completed = fields.filter(f => filledFieldIds.has(f.id)).length;
    const percent = Math.round((completed / total) * 100);

    return { completed, total, percent };
  }, [getFieldsForType, getSurveyData]);

  return {
    surveyTypes,
    loading,
    error,
    refresh: loadSurveyTypes,
    getFieldsForType,
    getSurveyData,
    getCompletionStatus,
    allFields,
    allSurveyData,
    refreshSurveyData: loadSurveyData,
  };
}
