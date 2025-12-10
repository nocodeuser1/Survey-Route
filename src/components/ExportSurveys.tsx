import { useState, useEffect } from 'react';
import { Download, X, FileText } from 'lucide-react';
import { supabase, Facility, Inspection } from '../lib/supabase';

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

  const handleExport = () => {
    const filteredInspections = getFilteredInspections();

    if (filteredInspections.length === 0) {
      alert('No inspections found for the selected criteria');
      return;
    }

    // Generate HTML report for all selected inspections
    let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Inspection Reports - ${selectedYear === 'all' ? 'All Years' : selectedYear}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .inspection-report { page-break-after: always; margin-bottom: 40px; border: 1px solid #ddd; padding: 20px; }
          .header { text-align: center; margin-bottom: 20px; }
          .section { margin: 20px 0; }
          .section-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; color: #333; }
          .item { margin: 10px 0; padding: 10px; border-left: 3px solid #ddd; }
          .compliant { border-left-color: #10b981; }
          .non-compliant { border-left-color: #ef4444; }
          .signature { margin-top: 30px; border-top: 1px solid #000; padding-top: 10px; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          td { padding: 5px; }
        </style>
      </head>
      <body>
    `;

    filteredInspections.forEach((inspection, index) => {
      const facility = facilities.find(f => f.id === inspection.facility_id);
      if (!facility) return;

      const conductedDate = new Date(inspection.conducted_at).toLocaleDateString();
      const items = inspection.inspection_items || [];

      htmlContent += `
        <div class="inspection-report">
          <div class="header">
            <h1>SPCC Inspection Report</h1>
            <h2>${facility.name}</h2>
            <p>${facility.address || 'No address provided'}</p>
            <p>Inspection Date: ${conductedDate}</p>
          </div>

          <div class="section">
            <div class="section-title">Facility Information</div>
            <table>
              <tr><td><strong>Name:</strong></td><td>${facility.name}</td></tr>
              <tr><td><strong>Address:</strong></td><td>${facility.address || 'N/A'}</td></tr>
              <tr><td><strong>Coordinates:</strong></td><td>${facility.latitude}, ${facility.longitude}</td></tr>
            </table>
          </div>

          <div class="section">
            <div class="section-title">Inspection Items</div>
            ${items.map(item => `
              <div class="item ${item.compliant ? 'compliant' : 'non-compliant'}">
                <strong>${item.item_number}. ${item.description}</strong><br>
                Status: <strong>${item.compliant ? 'Compliant' : 'Non-Compliant'}</strong>
                ${item.notes ? `<br>Notes: ${item.notes}` : ''}
                ${item.requires_action ? '<br><em>Action Required</em>' : ''}
              </div>
            `).join('')}
          </div>

          ${inspection.inspector_signature ? `
            <div class="signature">
              <p><strong>Inspector Signature:</strong></p>
              <img src="${inspection.inspector_signature}" style="max-width: 160px; max-height: 80px;" />
              <p>Date: ${conductedDate}</p>
            </div>
          ` : ''}
        </div>
      `;
    });

    htmlContent += '</body></html>';

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
                    disabled={filteredInspections.length === 0}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    <Download className="w-5 h-5" />
                    Export {filteredInspections.length} {filteredInspections.length === 1 ? 'Report' : 'Reports'} (HTML)
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
