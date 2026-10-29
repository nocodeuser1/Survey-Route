import { useState, useEffect } from 'react';
import { Download, X, FileText } from 'lucide-react';
import { supabase, Facility, Inspection, InspectionPhoto } from '../lib/supabase';
import { buildSurveysExportHtml, type ExportQuestion } from '../utils/surveyExportHtml';

/** Same approach as InspectionReportExport: embed photos so the file works offline. */
async function loadPhotoDataUrl(photoUrl: string | null): Promise<string> {
  if (!photoUrl) return '';
  if (photoUrl.startsWith('data:')) return photoUrl;
  try {
    const storagePath = photoUrl.replace(/^.*\/inspection-photos\//, '');
    const { data: blob, error } = await supabase.storage.from('inspection-photos').download(storagePath);
    if (error || !blob) {
      console.warn('[ExportSurveys] Failed to load photo:', storagePath, error);
      return '';
    }
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('[ExportSurveys] Error loading photo:', err);
    return '';
  }
}

interface ExportSurveysProps {
  facilityIds: string[];
  facilities: Facility[];
  userId: string;
  accountId: string;
  onClose: () => void;
}

export default function ExportSurveys({
  facilityIds,
  facilities,
  userId,
  accountId,
  onClose,
}: ExportSurveysProps) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadInspections();
  }, [facilityIds]);

  const loadInspections = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .in('facility_id', facilityIds)
        .eq('status', 'completed')
        .order('conducted_at', { ascending: false });

      if (error) throw error;

      setInspections(data || []);

      // Extract unique years from inspections
      const years = new Set<number>();
      data?.forEach(inspection => {
        const year = new Date(inspection.conducted_at).getFullYear();
        years.add(year);
      });
      setAvailableYears(Array.from(years).sort((a, b) => b - a));
    } catch (err) {
      console.error('Error loading inspections:', err);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredInspections = () => {
    if (selectedYear === 'all') return inspections;

    return inspections.filter(inspection => {
      const year = new Date(inspection.conducted_at).getFullYear();
      return year === selectedYear;
    });
  };

  const handleExport = async () => {
    const filteredInspections = getFilteredInspections();

    if (filteredInspections.length === 0) {
      alert('No inspections found for the selected criteria');
      return;
    }

    setExporting(true);
    try {
      const [templateResult, photosResult] = await Promise.all([
        supabase
          .from('inspection_templates')
          .select('*')
          .eq('name', 'SPCC Inspection')
          .maybeSingle(),
        supabase
          .from('inspection_photos')
          .select('*')
          .in('inspection_id', filteredInspections.map(i => i.id))
          .order('created_at', { ascending: false }),
      ]);
      if (templateResult.error) throw templateResult.error;
      if (photosResult.error) throw photosResult.error;

      const questions = (templateResult.data?.questions || []) as ExportQuestion[];
      const loadedPhotos = await Promise.all(((photosResult.data || []) as InspectionPhoto[]).map(async (photo) => ({
        ...photo,
        photo_url: await loadPhotoDataUrl(photo.photo_url),
      })));
      // Photos that failed to download are left out rather than printed broken.
      const photosByInspection = new Map<string, InspectionPhoto[]>();
      for (const photo of loadedPhotos) {
        if (!photo.photo_url) continue;
        photosByInspection.set(photo.inspection_id, [...(photosByInspection.get(photo.inspection_id) || []), photo]);
      }

      const htmlContent = buildSurveysExportHtml({
        title: `Inspection Reports - ${selectedYear === 'all' ? 'All Years' : selectedYear}`,
        inspections: filteredInspections,
        facilities,
        questions,
        photosByInspection,
      });

      // Create blob and download
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Inspection_Reports_${selectedYear}_${new Date().toISOString().split('T')[0]}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      console.error('Error exporting inspections:', err);
      alert('Failed to export inspection reports. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const filteredInspections = getFilteredInspections();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full my-8">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Export Inspection Reports</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading inspections...</p>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <p className="text-sm text-gray-600 mb-2">
                  {facilityIds.length} {facilityIds.length === 1 ? 'facility' : 'facilities'} selected
                </p>
                <p className="text-sm text-gray-600">
                  {inspections.length} total {inspections.length === 1 ? 'inspection' : 'inspections'} found
                </p>
              </div>

              {availableYears.length > 0 ? (
                <>
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                      Select Year
                    </label>
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="all">All Years ({inspections.length} inspections)</option>
                      {availableYears.map(year => {
                        const yearCount = inspections.filter(i =>
                          new Date(i.conducted_at).getFullYear() === year
                        ).length;
                        return (
                          <option key={year} value={year}>
                            {year} ({yearCount} {yearCount === 1 ? 'inspection' : 'inspections'})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-2 text-blue-900">
                      <FileText className="w-5 h-5" />
                      <div>
                        <p className="font-medium">
                          {filteredInspections.length} {filteredInspections.length === 1 ? 'inspection' : 'inspections'} ready to export
                        </p>
                        <p className="text-sm text-blue-700">
                          {selectedYear === 'all' ? 'All years included' : `Year ${selectedYear}`}
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleExport}
                    disabled={filteredInspections.length === 0 || exporting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    <Download className="w-5 h-5" />
                    {exporting
                      ? 'Preparing reports...'
                      : `Export ${filteredInspections.length} ${filteredInspections.length === 1 ? 'Report' : 'Reports'} (HTML)`}
                  </button>
                  <p className="text-xs text-gray-600 mt-2 text-center">
                    Download as HTML file, then open in browser and print to PDF
                  </p>
                </>
              ) : (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600">No completed inspections found for selected facilities</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
