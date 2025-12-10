import { useState, useEffect } from 'react';
import { Download, FileText, Loader, Search, ArrowUpDown } from 'lucide-react';
import { supabase, Facility, Inspection, InspectionTemplate, UserSettings, InspectionPhoto } from '../lib/supabase';
import { formatInspectionTimestamp } from '../utils/inspectionTimestamp';
import JSZip from 'jszip';

interface InspectionReportExportProps {
  facilities: Facility[];
  userId: string;
  accountId: string;
}

export default function InspectionReportExport({ facilities, userId, accountId }: InspectionReportExportProps) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [template, setTemplate] = useState<InspectionTemplate | null>(null);
  const [inspectionPhotos, setInspectionPhotos] = useState<Map<string, InspectionPhoto[]>>(new Map());
  const [selectedInspections, setSelectedInspections] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [accountBranding, setAccountBranding] = useState<{company_name?: string; logo_url?: string}>({});
  const [hideReportTimestamps, setHideReportTimestamps] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'facility' | 'flagged'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [combinedReport, setCombinedReport] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    loadData();
  }, [facilities]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const facilityIds = facilities.map(f => f.id);
      console.log('[InspectionReportExport] Loading inspections for facilities:', facilityIds.length);

      const [inspectionsResult, templateResult, brandingResult, settingsResult, photosResult] = await Promise.all([
        supabase
          .from('inspections')
          .select('*')
          .in('facility_id', facilityIds)
          .eq('status', 'completed')
          .order('conducted_at', { ascending: false }),
        supabase
          .from('inspection_templates')
          .select('*')
          .eq('name', 'SPCC Inspection')
          .maybeSingle(),
        supabase
          .from('accounts')
          .select('company_name, logo_url')
          .eq('id', accountId)
          .maybeSingle(),
        supabase
          .from('user_settings')
          .select('hide_report_timestamps')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('inspection_photos')
          .select('*')
          .in('inspection_id', facilityIds.length > 0 ? ['temp'] : [])
      ]);

      if (inspectionsResult.error) throw inspectionsResult.error;
      if (templateResult.error) throw templateResult.error;

      console.log('[InspectionReportExport] Loaded inspections:', inspectionsResult.data?.length || 0);
      const loadedInspections = inspectionsResult.data || [];
      setInspections(loadedInspections);
      setTemplate(templateResult.data);
      setAccountBranding(brandingResult.data || {});
      const hideTimestamps = settingsResult.data?.hide_report_timestamps || false;
      console.log('[InspectionReportExport] hide_report_timestamps setting:', hideTimestamps, 'from settings:', settingsResult.data);
      setHideReportTimestamps(hideTimestamps);

      if (loadedInspections.length > 0) {
        const { data: photos } = await supabase
          .from('inspection_photos')
          .select('*')
          .in('inspection_id', loadedInspections.map(i => i.id));

        console.log('[InspectionReportExport] Loaded photos:', photos?.length || 0);

        if (photos && photos.length > 0) {
          setLoadingProgress({ current: 0, total: photos.length });
          const photoMap = new Map<string, InspectionPhoto[]>();

          // Load all photos in parallel instead of sequentially
          const photoPromises = photos.map(async (photo, index) => {
            try {
              let imageDataUrl = photo.photo_url;

              if (photo.photo_url) {
                if (photo.photo_url.startsWith('data:')) {
                  imageDataUrl = photo.photo_url;
                } else {
                  const storagePath = photo.photo_url.replace(/^.*\/inspection-photos\//, '');
                  const { data: blob, error } = await supabase.storage
                    .from('inspection-photos')
                    .download(storagePath);

                  if (!error && blob) {
                    imageDataUrl = await new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onloadend = () => resolve(reader.result as string);
                      reader.readAsDataURL(blob);
                    });
                  } else {
                    console.warn('[InspectionReportExport] Failed to load photo:', storagePath, error);
                  }
                }
              }

              setLoadingProgress(prev => ({ ...prev, current: index + 1 }));
              return { ...photo, photo_url: imageDataUrl };
            } catch (err) {
              console.error('[InspectionReportExport] Error processing photo:', err);
              setLoadingProgress(prev => ({ ...prev, current: prev.current + 1 }));
              return { ...photo, photo_url: photo.photo_url };
            }
          });

          // Wait for all photos to load in parallel
          const loadedPhotos = await Promise.all(photoPromises);

          // Build the photo map
          for (const photoWithUrl of loadedPhotos) {
            const existing = photoMap.get(photoWithUrl.inspection_id) || [];
            photoMap.set(photoWithUrl.inspection_id, [...existing, photoWithUrl]);
          }

          setInspectionPhotos(photoMap);
          setLoadingProgress({ current: 0, total: 0 });
        }
      }
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleInspection = (id: string) => {
    setSelectedInspections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedInspections(new Set(inspections.map(i => i.id)));
  };

  const clearAll = () => {
    setSelectedInspections(new Set());
  };

  const generateReport = (inspection: Inspection) => {
    const facility = facilities.find(f => f.id === inspection.facility_id);
    if (!facility || !template) return '';

    console.log('[InspectionReportExport] Generating report with hideReportTimestamps:', hideReportTimestamps);

    const flaggedResponses = inspection.responses.filter(r => r.answer === 'no');
    const actionResponses = inspection.responses.filter(r => r.action_required);
    const inspectionTitle = 'SPCC Inspection';
    const photos = inspectionPhotos.get(inspection.id) || [];
    const photosByQuestion = new Map<string, InspectionPhoto[]>();
    photos.forEach(photo => {
      const existing = photosByQuestion.get(photo.question_id) || [];
      photosByQuestion.set(photo.question_id, [...existing, photo]);
    });

    return `
      <div class="report-page">
        <div class="report-header">
          ${accountBranding.logo_url ? `<div class="logo-container"><img src="${accountBranding.logo_url}" alt="Company Logo" class="company-logo" /></div>` : ''}
          <h1>${inspectionTitle.toUpperCase()}</h1>
          <div class="report-meta">
            <div class="meta-row">
              <span class="label">Location Inspected:</span>
              <span class="value">${facility.name}</span>
            </div>
            <div class="meta-row">
              <span class="label">Conducted on:</span>
              <span class="value">${formatInspectionTimestamp(inspection, hideReportTimestamps)}</span>
            </div>
            <div class="meta-row">
              <span class="label">Document Identifier:</span>
              <span class="value">SPCC</span>
            </div>
            <div class="meta-row">
              <span class="label">Prepared by:</span>
              <span class="value">${inspection.inspector_name}</span>
            </div>
          </div>
        </div>

        ${inspection.flagged_items_count > 0 || inspection.actions_count > 0 ? `
          <div class="summary-stats">
            ${inspection.flagged_items_count > 0 ? `
              <div class="stat-card flagged-stat">
                <div class="stat-icon">⚠</div>
                <div class="stat-content">
                  <div class="stat-label">Flagged Items</div>
                  <div class="stat-value">${inspection.flagged_items_count}</div>
                </div>
              </div>
            ` : ''}
            ${inspection.actions_count > 0 ? `
              <div class="stat-card action-stat">
                <div class="stat-icon">⚡</div>
                <div class="stat-content">
                  <div class="stat-label">Action Items</div>
                  <div class="stat-value">${inspection.actions_count}</div>
                </div>
              </div>
            ` : ''}
          </div>
        ` : ''}

        <div class="report-section">
          <h2>Audit</h2>
          ${template.questions.map((question: any) => {
            const response = inspection.responses.find(r => r.question_id === question.id);
            if (!response) return '';

            const hasExtras = response.comments || response.action_required;
            const questionPhotos = photosByQuestion.get(question.id) || [];
            return `
              <div class="question-row ${response.answer === 'no' ? 'flagged' : ''} ${hasExtras ? 'has-extras' : ''}">
                <div class="question-content">
                  <div class="question-text">${question.text}</div>
                  ${response.comments ? `<div class="row-comments">${response.comments}</div>` : ''}
                  ${response.action_required ? `<div class="row-action"><strong>⚠ ACTION REQUIRED:</strong> ${response.action_notes}</div>` : ''}
                  ${questionPhotos.length > 0 ? `
                    <div class="photo-grid">
                      ${questionPhotos.map((photo, idx) => `
                        <img
                          src="${photo.photo_url}"
                          alt="Inspection photo ${idx + 1}"
                          class="photo-thumbnail"
                          onclick="openPhotoModal(this.src)"
                        />
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
                <div class="answer ${response.answer === 'yes' ? 'answer-yes' : response.answer === 'no' ? 'answer-no' : 'answer-na'}">
                  ${response.answer?.toUpperCase() || 'N/A'}
                </div>
              </div>
            `;
          }).join('')}
        </div>

        ${inspection.signature_data ? `
          <div class="signature-section">
            <h3>Inspector Signature</h3>
            <img src="${inspection.signature_data}" alt="Signature" class="signature-image" />
            <div class="signature-info">
              <div>${inspection.inspector_name}</div>
              <div>${formatInspectionTimestamp(inspection, hideReportTimestamps)}</div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  };

  const generateCombinedReport = (selectedInspectionsList: Inspection[]) => {
    // Generate summary data for each facility
    const summaryData = selectedInspectionsList.map(inspection => {
      const facility = facilities.find(f => f.id === inspection.facility_id);
      return {
        inspection,
        facility,
        hasFlagged: inspection.flagged_items_count > 0,
        hasActions: inspection.actions_count > 0,
      };
    });

    const totalFlagged = summaryData.reduce((sum, item) => sum + item.inspection.flagged_items_count, 0);
    const totalActions = summaryData.reduce((sum, item) => sum + item.inspection.actions_count, 0);
    const facilitiesWithFindings = summaryData.filter(item => item.hasFlagged).length;

    // Calculate unique facilities count
    const uniqueFacilities = new Set(selectedInspectionsList.map(i => i.facility_id));
    const uniqueFacilityCount = uniqueFacilities.size;

    const summaryHTML = `
      <div class="combined-summary">
        <div class="summary-header">
          ${accountBranding.logo_url ? `<div class="logo-container"><img src="${accountBranding.logo_url}" alt="Company Logo" class="company-logo" /></div>` : ''}
          <h1>SPCC Inspection Report Summary</h1>
          <p class="summary-date">Generated: ${new Date().toLocaleDateString()}</p>
        </div>

        <div class="summary-stats">
          <div class="stat-card stat-card-clickable" onclick="sortFacilities('name')" data-sort="name">
            <div class="stat-value">${uniqueFacilityCount}</div>
            <div class="stat-label">Total Facilities</div>
          </div>
          <div class="stat-card stat-card-clickable ${facilitiesWithFindings > 0 ? 'stat-warning' : 'stat-success'}" onclick="sortFacilities('findings')" data-sort="findings">
            <div class="stat-value">${facilitiesWithFindings}</div>
            <div class="stat-label">With Findings</div>
          </div>
          <div class="stat-card stat-card-clickable ${totalFlagged > 0 ? 'stat-danger' : 'stat-success'}" onclick="sortFacilities('flagged')" data-sort="flagged">
            <div class="stat-value">${totalFlagged}</div>
            <div class="stat-label">Flagged Items</div>
          </div>
          <div class="stat-card stat-card-clickable ${totalActions > 0 ? 'stat-warning' : 'stat-success'}" onclick="sortFacilities('actions')" data-sort="actions">
            <div class="stat-value">${totalActions}</div>
            <div class="stat-label">Action Items</div>
          </div>
        </div>

        <div class="facility-list-container">
          <table class="facility-table">
            <thead>
              <tr>
                <th class="facility-name-header">Facility Name</th>
                <th class="date-header">Inspection Date</th>
                <th class="inspector-header">Inspector</th>
                <th class="status-header">Status</th>
                <th class="flagged-header">Flagged</th>
                <th class="actions-header">Actions</th>
              </tr>
            </thead>
            <tbody id="facilityTableBody">
              ${summaryData.map((item, index) => `
                <tr class="facility-row"
                    onclick="openReportModal(${index})"
                    data-index="${index}"
                    data-facility-name="${(item.facility?.name || 'Unknown Facility').toLowerCase()}"
                    data-has-findings="${item.hasFlagged}"
                    data-flagged-count="${item.inspection.flagged_items_count}"
                    data-actions-count="${item.hasActions ? item.inspection.actions_count : 0}">
                  <td class="facility-name">${item.facility?.name || 'Unknown Facility'}</td>
                  <td class="inspection-date">${formatInspectionTimestamp(item.inspection, hideReportTimestamps)}</td>
                  <td class="inspector-name">${item.inspection.inspector_name}</td>
                  <td class="status-cell">
                    <span class="status-badge ${item.hasFlagged ? 'badge-warning' : 'badge-success'}">
                      ${item.hasFlagged ? '⚠ Findings' : '✓ Pass'}
                    </span>
                  </td>
                  <td class="flagged-count ${item.inspection.flagged_items_count > 0 ? 'has-flagged' : ''}">
                    ${item.inspection.flagged_items_count > 0 ? item.inspection.flagged_items_count : '-'}
                  </td>
                  <td class="actions-count ${item.hasActions ? 'has-actions' : ''}">
                    ${item.hasActions ? item.inspection.actions_count : '-'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Report Modal -->
      <div id="reportModal" class="report-modal" data-total-reports="${summaryData.length}">
        <div class="report-modal-overlay" onclick="closeReportModal()"></div>
        <div class="report-modal-content">
          <div class="report-modal-header">
            <div class="report-modal-nav">
              <button id="prevReportBtn" class="report-nav-btn" onclick="navigateReport(-1)">
                ← Previous
              </button>
              <span id="reportModalTitle" class="report-modal-title"></span>
              <button id="nextReportBtn" class="report-nav-btn" onclick="navigateReport(1)">
                Next →
              </button>
            </div>
            <button class="report-modal-close" onclick="closeReportModal()" title="Close">×</button>
          </div>
          <div id="reportModalBody" class="report-modal-body">
            <!-- Report content will be inserted here -->
          </div>
        </div>
      </div>

      <div id="facilityReports" style="display: none;">
        ${summaryData.map((item, index) => `
          <div id="facility-${index}" class="facility-report-section" data-facility-index="${index}">
            ${generateReport(item.inspection)}
          </div>
        `).join('')}
      </div>

      <button id="backToTop" class="back-to-top" onclick="scrollToTop()" style="display: none;" title="Back to Summary">
        ↑
      </button>

      <a href="https://www.survey-route.com" target="_blank" rel="noopener noreferrer" class="surveyroute-branding" title="Powered by Survey-Route">
        <svg class="surveyroute-logo" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="80" height="80" rx="12" fill="#3B82F6"/>
          <path d="M35 25C35 23.3431 36.3431 22 38 22H42C43.6569 22 45 23.3431 45 25V25C45 26.6569 43.6569 28 42 28H38C36.3431 28 35 26.6569 35 25V25Z" fill="white"/>
          <circle cx="40" cy="40" r="4" fill="white"/>
          <path d="M35 55C35 53.3431 36.3431 52 38 52H42C43.6569 52 45 53.3431 45 55V55C45 56.6569 43.6569 58 42 58H38C36.3431 58 35 56.6569 35 55V55Z" fill="white"/>
          <path d="M28 38C28 36.3431 29.3431 35 31 35H35C36.6569 35 38 36.3431 38 38V42C38 43.6569 36.6569 45 35 45H31C29.3431 45 28 43.6569 28 42V38Z" fill="white"/>
          <path d="M42 38C42 36.3431 43.3431 35 45 35H49C50.6569 35 52 36.3431 52 38V42C52 43.6569 50.6569 45 49 45H45C43.3431 45 42 43.6569 42 42V38Z" fill="white"/>
          <line x1="40" y1="28" x2="40" y2="36" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="40" y1="44" x2="40" y2="52" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="38" y1="40" x2="28" y2="40" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="52" y1="40" x2="42" y2="40" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <div class="surveyroute-text">
          <span class="surveyroute-title">Survey-Route</span>
          <span class="surveyroute-subtitle">by BEAR DATA</span>
        </div>
      </a>
    `;

    return summaryHTML;
  };

  const getPrintOptimizedCSS = () => {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }

      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
        color: #1a1a1a;
        background: #ffffff;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .report-page {
        max-width: 210mm;
        margin: 0 auto;
        padding: 20mm;
        background: white;
      }

      @media print {
        body {
          margin: 0;
          padding: 0;
        }

        .report-page {
          max-width: 100%;
          margin: 0;
          padding: 15mm;
          page-break-after: always;
        }

        .photo-grid {
          page-break-inside: avoid;
        }

        .question-row {
          page-break-inside: avoid;
        }

        .signature-section {
          page-break-inside: avoid;
        }
      }

      @page {
        size: A4;
        margin: 15mm;
      }

      .logo-container {
        text-align: center;
        margin-bottom: 20px;
        padding-bottom: 15px;
        border-bottom: 2px solid #e5e7eb;
      }

      .company-logo {
        max-height: 60px;
        max-width: 250px;
        object-fit: contain;
      }

      .report-header {
        border-bottom: 3px solid #1e3a8a;
        padding-bottom: 20px;
        margin-bottom: 30px;
      }

      .report-header h1 {
        font-size: 28px;
        font-weight: 700;
        color: #1e3a8a;
        margin-bottom: 20px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      .report-meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        background: #f8fafc;
        padding: 15px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }

      .meta-row {
        padding: 8px 10px;
        background: white;
        border-radius: 4px;
        border: 1px solid #e5e7eb;
        font-size: 13px;
      }

      .meta-row .label {
        font-weight: 600;
        color: #475569;
        margin-right: 8px;
        display: inline-block;
        min-width: 120px;
      }

      .meta-row .value {
        color: #1e293b;
      }

      .summary-stats {
        display: flex;
        gap: 12px;
        margin: 25px 0;
        justify-content: center;
      }

      .stat-card {
        background: linear-gradient(135deg, #fff 0%, #f8fafc 100%);
        border: 2px solid #e5e7eb;
        border-radius: 10px;
        padding: 15px 25px;
        text-align: center;
        min-width: 140px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
      }

      .stat-card.flagged-stat {
        border-color: #dc2626;
        background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
      }

      .stat-card.action-stat {
        border-color: #f59e0b;
        background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
      }

      .stat-icon {
        font-size: 24px;
        margin-bottom: 8px;
      }

      .stat-label {
        font-size: 12px;
        color: #64748b;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }

      .stat-value {
        font-size: 28px;
        font-weight: 700;
        color: #1e293b;
      }

      .report-section {
        margin-bottom: 30px;
      }

      .report-section h2 {
        font-size: 20px;
        font-weight: 600;
        color: #1e3a8a;
        margin-bottom: 20px;
        padding-bottom: 10px;
        border-bottom: 2px solid #e5e7eb;
      }

      .question-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 14px;
        margin-bottom: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #ffffff;
        gap: 15px;
      }

      .question-row.flagged {
        border-left: 4px solid #dc2626;
        background: linear-gradient(135deg, #fef2f2 0%, #ffffff 100%);
      }

      .question-row.has-extras {
        background: linear-gradient(135deg, #fffbeb 0%, #ffffff 100%);
      }

      .question-content {
        flex: 1;
      }

      .question-text {
        font-size: 14px;
        font-weight: 500;
        color: #1e293b;
        line-height: 1.6;
        margin-bottom: 8px;
      }

      .row-comments {
        background: #f8fafc;
        padding: 10px;
        border-radius: 4px;
        font-size: 13px;
        color: #475569;
        margin-top: 8px;
        border-left: 3px solid #3b82f6;
      }

      .row-action {
        background: #fef3c7;
        padding: 10px;
        border-radius: 4px;
        font-size: 13px;
        color: #92400e;
        margin-top: 8px;
        border-left: 3px solid #f59e0b;
      }

      .answer {
        font-size: 14px;
        font-weight: 700;
        padding: 8px 16px;
        border-radius: 6px;
        min-width: 60px;
        text-align: center;
        white-space: nowrap;
      }

      .answer-yes {
        background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
        color: #065f46;
        border: 2px solid #059669;
      }

      .answer-no {
        background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
        color: #7f1d1d;
        border: 2px solid #dc2626;
      }

      .answer-na {
        background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
        color: #475569;
        border: 2px solid #94a3b8;
      }

      .photo-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 10px;
        margin-top: 12px;
      }

      .photo-thumbnail {
        width: 100%;
        height: 150px;
        object-fit: cover;
        border-radius: 6px;
        border: 2px solid #e5e7eb;
        cursor: pointer;
        transition: transform 0.2s;
      }

      .photo-thumbnail:hover {
        transform: scale(1.05);
        border-color: #3b82f6;
      }

      .signature-section {
        margin-top: 40px;
        padding-top: 30px;
        border-top: 2px solid #e5e7eb;
      }

      .signature-section h3 {
        font-size: 16px;
        font-weight: 600;
        color: #1e3a8a;
        margin-bottom: 15px;
      }

      .signature-image {
        max-width: 240px;
        height: auto;
      }

      .signature-info {
        margin-top: 10px;
        font-size: 13px;
        color: #64748b;
      }

      .signature-info div {
        margin-bottom: 4px;
      }
    `;
  };

  const generateStandaloneReport = (inspection: Inspection) => {
    const reportContent = generateReport(inspection);
    const facility = facilities.find(f => f.id === inspection.facility_id);
    const facilityName = facility?.name || 'Unknown Facility';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${facilityName} - SPCC Inspection Report</title>
        <style>
          ${getPrintOptimizedCSS()}
        </style>
      </head>
      <body>
        ${reportContent}
      </body>
      </html>
    `;
  };

  const exportReports = async () => {
    const selectedInspectionsList = inspections.filter(i => selectedInspections.has(i.id));

    if (selectedInspectionsList.length === 0) {
      alert('Please select at least one inspection to export');
      return;
    }

    // If not combined and multiple reports, create a zip file
    if (!combinedReport && selectedInspectionsList.length > 1) {
      const zip = new JSZip();

      selectedInspectionsList.forEach((inspection) => {
        const facility = facilities.find(f => f.id === inspection.facility_id);
        const facilityName = facility?.name || 'Unknown Facility';
        const safeFileName = facilityName.replace(/[^a-z0-9]/gi, '_');
        const htmlContent = generateStandaloneReport(inspection);
        const fileName = `${safeFileName}_SPCC_Inspection_${new Date().toISOString().split('T')[0]}.html`;
        zip.file(fileName, htmlContent);
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SPCC_Inspection_Reports_${selectedInspectionsList.length}_Facilities_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const reportsHTML = combinedReport
      ? generateCombinedReport(selectedInspectionsList)
      : selectedInspectionsList.map(i => generateReport(i)).join('');

    const fullHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>SPCC Inspection Reports</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.75;
            color: #1a1a1a;
            background: #ffffff;
          }

          .report-page {
            max-width: 850px;
            margin: 0 auto;
            padding: 60px 50px;
            page-break-after: always;
            background: white;
          }

          .logo-container {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid #e5e7eb;
          }

          .company-logo {
            max-height: 80px;
            max-width: 300px;
            object-fit: contain;
          }

          .report-header {
            border-bottom: 4px solid #1e3a8a;
            padding-bottom: 30px;
            margin-bottom: 40px;
          }

          .report-header h1 {
            font-size: 36px;
            font-weight: 700;
            color: #1e3a8a;
            margin-bottom: 25px;
            letter-spacing: 0.5px;
            text-transform: uppercase;
          }

          .report-meta {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            background: #f8fafc;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }

          .meta-row {
            padding: 10px 12px;
            background: white;
            border-radius: 4px;
            border: 1px solid #e5e7eb;
            font-size: 14px;
          }

          .meta-row .label {
            font-weight: 600;
            color: #475569;
            margin-right: 8px;
            display: inline-block;
            min-width: 140px;
          }

          .meta-row .value {
            color: #1e293b;
          }

          .summary-stats {
            display: flex;
            gap: 16px;
            margin: 30px 0;
            justify-content: center;
          }

          .stat-card {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            min-width: 140px;
          }

          .stat-card.flagged-stat {
            background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
            border: 2px solid #fca5a5;
          }

          .stat-card.action-stat {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border: 2px solid #fcd34d;
          }

          .stat-icon {
            font-size: 20px;
            line-height: 1;
          }

          .stat-content {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .stat-label {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #475569;
          }

          .stat-value {
            font-size: 18px;
            font-weight: 700;
            color: #1e293b;
          }

          .report-section {
            margin: 25px 0 45px 0;
            page-break-inside: avoid;
          }

          .report-section h2 {
            background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
            color: white;
            padding: 16px 20px;
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 0;
            border-radius: 8px 8px 0 0;
            letter-spacing: 0.5px;
          }

          .question-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 20px;
            border-bottom: 1px solid #e5e7eb;
            background: white;
            transition: all 0.2s ease;
            min-height: 60px;
          }

          .question-row:last-child {
            border-bottom: none;
            border-radius: 0 0 8px 8px;
          }

          .question-row.has-extras {
            min-height: 80px;
            padding: 24px 20px;
          }

          .question-row.flagged {
            background: #fef2f2;
            border-left: 5px solid #dc2626;
            box-shadow: inset 0 0 0 1px #fecaca;
          }

          .question-content {
            flex: 1;
            padding-right: 30px;
          }

          .question-text {
            font-size: 15px;
            font-weight: 500;
            color: #1e293b;
            margin-bottom: 8px;
            line-height: 1.6;
          }

          .row-comments {
            margin-top: 12px;
            padding: 12px 16px;
            background: #f1f5f9;
            border-left: 3px solid #64748b;
            border-radius: 4px;
            font-size: 14px;
            color: #475569;
            font-style: italic;
            line-height: 1.6;
          }

          .row-action {
            margin-top: 12px;
            padding: 14px 16px;
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            border-radius: 4px;
            font-size: 14px;
            color: #92400e;
            line-height: 1.6;
          }

          .row-action strong {
            display: block;
            margin-bottom: 4px;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .photo-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: 10px;
            margin-top: 12px;
            padding: 12px;
            background: transparent;
          }

          .photo-thumbnail {
            width: 100%;
            height: 100px;
            object-fit: cover;
            border-radius: 4px;
            cursor: pointer;
            border: 2px solid #d1d5db;
            transition: all 0.2s ease;
          }

          .photo-thumbnail:hover {
            transform: scale(1.05);
            border-color: #3b82f6;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
          }

          .answer {
            padding: 12px 24px;
            border-radius: 6px;
            font-weight: 700;
            text-align: center;
            min-width: 70px;
            font-size: 14px;
            letter-spacing: 0.5px;
            align-self: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }

          .answer-yes {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
          }

          .answer-no {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
          }

          .answer-na {
            background: linear-gradient(135deg, #94a3b8 0%, #64748b 100%);
            color: white;
          }

          .signature-section {
            margin-top: 60px;
            padding: 30px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            background: #fafafa;
            page-break-inside: avoid;
          }

          .signature-section h3 {
            font-size: 18px;
            font-weight: 600;
            color: #1e3a8a;
            margin-bottom: 20px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .signature-image {
            height: auto;
            max-height: 96px;
            width: auto;
            max-width: 280px;
            object-fit: contain;
            filter: invert(23%) sepia(89%) saturate(1869%) hue-rotate(201deg) brightness(93%) contrast(90%);
          }

          .signature-info {
            margin-top: 15px;
            color: #475569;
            font-size: 14px;
            line-height: 1.8;
          }

          .signature-info div {
            padding: 4px 0;
          }

          .photo-modal {
            display: none;
            position: fixed;
            z-index: 10000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.9);
            justify-content: center;
            align-items: center;
          }

          .photo-modal.active {
            display: flex;
          }

          .photo-modal-content {
            position: relative;
            max-width: 90%;
            max-height: 90%;
            display: flex;
            justify-content: center;
            align-items: center;
          }

          .photo-modal img {
            max-width: 100%;
            max-height: 90vh;
            object-fit: contain;
            border-radius: 8px;
            transition: transform 0.3s ease;
            cursor: grab;
          }

          .photo-modal img.dragging {
            cursor: grabbing;
          }

          .photo-modal img.zoomed {
            cursor: grab;
          }

          .photo-modal-close {
            position: absolute;
            top: 20px;
            right: 40px;
            color: white;
            font-size: 40px;
            font-weight: bold;
            cursor: pointer;
            background: rgba(0, 0, 0, 0.5);
            width: 50px;
            height: 50px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
          }

          .photo-modal-close:hover {
            background: rgba(0, 0, 0, 0.8);
          }

          .zoom-controls {
            position: absolute;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 10px;
            background: rgba(0, 0, 0, 0.7);
            padding: 10px;
            border-radius: 8px;
            z-index: 10001;
          }

          .zoom-btn {
            color: white;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.3);
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
          }

          .zoom-btn:hover {
            background: rgba(255, 255, 255, 0.2);
          }

          .combined-summary {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
          }

          .summary-header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 3px solid #2563eb;
          }

          .summary-header .logo-container {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
          }

          .summary-header .company-logo {
            max-height: 80px;
            max-width: 300px;
            object-fit: contain;
          }

          .summary-header h1 {
            font-size: 32px;
            margin-bottom: 10px;
            color: #1a1a1a;
          }

          .summary-header h2 {
            font-size: 24px;
            color: #4b5563;
            margin-bottom: 10px;
          }

          .summary-date {
            color: #6b7280;
            font-size: 14px;
          }

          .summary-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
          }

          .stat-card {
            background: white;
            border: 2px solid #e5e7eb;
            border-radius: 12px;
            padding: 24px;
            text-align: center;
            transition: transform 0.2s, box-shadow 0.2s;
          }

          .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          }

          .stat-card.stat-success {
            border-color: #10b981;
            background: linear-gradient(135deg, #ecfdf5 0%, #ffffff 100%);
          }

          .stat-card.stat-warning {
            border-color: #f59e0b;
            background: linear-gradient(135deg, #fffbeb 0%, #ffffff 100%);
          }

          .stat-card.stat-danger {
            border-color: #ef4444;
            background: linear-gradient(135deg, #fef2f2 0%, #ffffff 100%);
          }

          .stat-value {
            font-size: 36px;
            font-weight: bold;
            color: #1a1a1a;
            margin-bottom: 8px;
          }

          .stat-label {
            font-size: 14px;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .facility-list-container {
            margin-bottom: 60px;
            overflow-x: auto;
          }

          .facility-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          }

          .facility-table thead {
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            border-bottom: 2px solid #e5e7eb;
          }

          .facility-table th {
            padding: 16px 20px;
            text-align: left;
            font-size: 13px;
            font-weight: 700;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .facility-table th.flagged-header,
          .facility-table th.actions-header {
            text-align: center;
            width: 100px;
          }

          .facility-table th.status-header {
            text-align: center;
            width: 120px;
          }

          .facility-table th.date-header {
            width: 160px;
          }

          .facility-table tbody tr {
            border-bottom: 1px solid #f1f5f9;
            transition: all 0.2s ease;
            cursor: pointer;
          }

          .facility-table tbody tr:hover {
            background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
            transform: scale(1.01);
            box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1);
          }

          .facility-table tbody tr:last-child {
            border-bottom: none;
          }

          .facility-table td {
            padding: 16px 20px;
            font-size: 14px;
            color: #1e293b;
          }

          .facility-table td.facility-name {
            font-weight: 600;
            color: #0f172a;
          }

          .facility-table td.inspection-date {
            color: #64748b;
          }

          .facility-table td.inspector-name {
            color: #475569;
          }

          .facility-table td.status-cell {
            text-align: center;
          }

          .status-badge {
            display: inline-block;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
          }

          .badge-success {
            background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
            color: #065f46;
          }

          .badge-warning {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            color: #92400e;
          }

          .facility-table td.flagged-count,
          .facility-table td.actions-count {
            text-align: center;
            font-weight: 600;
            color: #94a3b8;
          }

          .facility-table td.flagged-count.has-flagged {
            color: #dc2626;
            font-weight: 700;
          }

          .facility-table td.actions-count.has-actions {
            color: #f59e0b;
            font-weight: 700;
          }

          .facility-report-section {
            margin-bottom: 60px;
            scroll-margin-top: 20px;
          }

          .section-nav {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 20px;
            padding: 15px;
            background: #f9fafb;
            border-radius: 8px;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          }

          .nav-btn {
            padding: 10px 20px;
            border: 1px solid #d1d5db;
            background: white;
            color: #374151;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
          }

          .nav-btn:hover {
            background: #2563eb;
            color: white;
            border-color: #2563eb;
          }

          .nav-btn-primary {
            background: #2563eb;
            color: white;
            border-color: #2563eb;
          }

          .nav-btn-primary:hover {
            background: #1d4ed8;
          }

          .back-to-top {
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 56px;
            height: 56px;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 50%;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            transition: all 0.3s;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
          }

          .back-to-top:hover {
            background: #1d4ed8;
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
          }

          .surveyroute-branding {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: white;
            border: 2px solid #3b82f6;
            border-radius: 12px;
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            transition: all 0.3s;
            z-index: 1000;
            text-decoration: none;
          }

          .surveyroute-branding:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3);
            border-color: #2563eb;
          }

          .surveyroute-logo {
            width: 40px;
            height: 40px;
            border-radius: 8px;
          }

          .surveyroute-text {
            display: flex;
            flex-direction: column;
            line-height: 1.2;
          }

          .surveyroute-title {
            font-size: 16px;
            font-weight: 700;
            color: #1e293b;
          }

          .surveyroute-subtitle {
            font-size: 11px;
            color: #94a3b8;
            font-weight: 500;
          }

          .report-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 2000;
          }

          .report-modal.active {
            display: block;
          }

          .report-modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
          }

          .report-modal-content {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 95%;
            max-width: 1200px;
            height: 90vh;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .report-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 24px;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            flex-shrink: 0;
          }

          .report-modal-nav {
            display: flex;
            align-items: center;
            gap: 16px;
            flex: 1;
          }

          .report-modal-title {
            font-size: 18px;
            font-weight: 600;
            color: #1e293b;
            flex: 1;
            text-align: center;
          }

          .report-nav-btn {
            padding: 8px 16px;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s;
            white-space: nowrap;
          }

          .report-nav-btn:hover {
            background: #1d4ed8;
          }

          .report-nav-btn:disabled {
            background: #cbd5e1;
            cursor: not-allowed;
          }

          .report-modal-close {
            width: 36px;
            height: 36px;
            background: transparent;
            border: none;
            font-size: 32px;
            color: #64748b;
            cursor: pointer;
            border-radius: 6px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
            padding: 0;
            margin-left: 16px;
          }

          .report-modal-close:hover {
            background: #e2e8f0;
            color: #1e293b;
          }

          .report-modal-body {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
            background: white;
          }

          @media print {
            .report-modal {
              display: none !important;
            }
            .photo-modal {
              display: none !important;
            }
            .surveyroute-branding {
              display: none !important;
            }
            .back-to-top {
              display: none !important;
            }
            body {
              margin: 0;
              background: white;
            }

            .report-page {
              page-break-after: always;
              padding: 40px 30px;
              max-width: 100%;
            }

            .report-section {
              page-break-inside: avoid;
            }

            .question-row {
              page-break-inside: avoid;
            }

            .signature-section {
              page-break-inside: avoid;
            }
          }

          @page {
            margin: 0.75in;
            size: letter;
          }
        </style>
      </head>
      <body>
        <div id="photoModal" class="photo-modal" onclick="closePhotoModal(event)">
          <span class="photo-modal-close" onclick="closePhotoModal(event)">&times;</span>
          <div class="photo-modal-content">
            <img id="modalImage" src="" alt="Full size photo" />
            <div class="zoom-controls">
              <button class="zoom-btn" onclick="zoomPhoto(-0.2)">-</button>
              <button class="zoom-btn" onclick="resetZoom()">Reset</button>
              <button class="zoom-btn" onclick="zoomPhoto(0.2)">+</button>
            </div>
          </div>
        </div>
        ${reportsHTML}
        <script>
          let currentZoom = 1;
          let isDragging = false;
          let startX = 0;
          let startY = 0;
          let translateX = 0;
          let translateY = 0;

          function openPhotoModal(src) {
            const modal = document.getElementById('photoModal');
            const img = document.getElementById('modalImage');
            img.src = src;
            modal.classList.add('active');
            currentZoom = 1;
            translateX = 0;
            translateY = 0;
            img.style.transform = 'scale(1) translate(0px, 0px)';
            img.classList.remove('zoomed');
          }

          function closePhotoModal(event) {
            if (event.target.id === 'photoModal' || event.target.className.includes('photo-modal-close')) {
              const modal = document.getElementById('photoModal');
              modal.classList.remove('active');
              isDragging = false;
            }
          }

          function zoomPhoto(delta) {
            const img = document.getElementById('modalImage');
            currentZoom = Math.max(0.5, Math.min(3, currentZoom + delta));
            img.style.transform = \`scale(\${currentZoom}) translate(\${translateX}px, \${translateY}px)\`;
            if (currentZoom > 1) {
              img.classList.add('zoomed');
            } else {
              img.classList.remove('zoomed');
              translateX = 0;
              translateY = 0;
              img.style.transform = \`scale(\${currentZoom}) translate(0px, 0px)\`;
            }
          }

          function resetZoom() {
            const img = document.getElementById('modalImage');
            currentZoom = 1;
            translateX = 0;
            translateY = 0;
            img.style.transform = 'scale(1) translate(0px, 0px)';
            img.classList.remove('zoomed');
          }

          const modalImage = document.getElementById('modalImage');

          modalImage.addEventListener('mousedown', function(e) {
            if (currentZoom > 1) {
              isDragging = true;
              startX = e.clientX - translateX;
              startY = e.clientY - translateY;
              modalImage.classList.add('dragging');
              e.preventDefault();
            }
          });

          document.addEventListener('mousemove', function(e) {
            if (isDragging && currentZoom > 1) {
              translateX = e.clientX - startX;
              translateY = e.clientY - startY;
              modalImage.style.transform = \`scale(\${currentZoom}) translate(\${translateX}px, \${translateY}px)\`;
              e.preventDefault();
            }
          });

          document.addEventListener('mouseup', function() {
            if (isDragging) {
              isDragging = false;
              modalImage.classList.remove('dragging');
            }
          });

          document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
              const photoModal = document.getElementById('photoModal');
              const reportModal = document.getElementById('reportModal');

              if (photoModal.classList.contains('active')) {
                photoModal.classList.remove('active');
                isDragging = false;
              } else if (reportModal.classList.contains('active')) {
                closeReportModal();
              }
            } else if (event.key === 'ArrowLeft') {
              const reportModal = document.getElementById('reportModal');
              if (reportModal.classList.contains('active')) {
                navigateReport(-1);
              }
            } else if (event.key === 'ArrowRight') {
              const reportModal = document.getElementById('reportModal');
              if (reportModal.classList.contains('active')) {
                navigateReport(1);
              }
            }
          });

          // Sorting functionality
          let currentSort = 'name';

          function sortFacilities(sortType) {
            currentSort = sortType;
            const tbody = document.getElementById('facilityTableBody');
            const rows = Array.from(tbody.querySelectorAll('.facility-row'));
            const statCards = document.querySelectorAll('.stat-card');

            // Update active state on stat cards
            statCards.forEach(card => {
              if (card.getAttribute('data-sort') === sortType) {
                card.classList.add('active');
              } else {
                card.classList.remove('active');
              }
            });

            // Sort rows based on type
            rows.sort((a, b) => {
              if (sortType === 'name') {
                const nameA = a.getAttribute('data-facility-name');
                const nameB = b.getAttribute('data-facility-name');
                return nameA.localeCompare(nameB);
              } else if (sortType === 'findings') {
                const findingsA = a.getAttribute('data-has-findings') === 'true' ? 1 : 0;
                const findingsB = b.getAttribute('data-has-findings') === 'true' ? 1 : 0;
                if (findingsB !== findingsA) return findingsB - findingsA;
                return a.getAttribute('data-facility-name').localeCompare(b.getAttribute('data-facility-name'));
              } else if (sortType === 'flagged') {
                const flaggedA = parseInt(a.getAttribute('data-flagged-count'));
                const flaggedB = parseInt(b.getAttribute('data-flagged-count'));
                if (flaggedB !== flaggedA) return flaggedB - flaggedA;
                return a.getAttribute('data-facility-name').localeCompare(b.getAttribute('data-facility-name'));
              } else if (sortType === 'actions') {
                const actionsA = parseInt(a.getAttribute('data-actions-count'));
                const actionsB = parseInt(b.getAttribute('data-actions-count'));
                if (actionsB !== actionsA) return actionsB - actionsA;
                return a.getAttribute('data-facility-name').localeCompare(b.getAttribute('data-facility-name'));
              }
              return 0;
            });

            // Clear and re-append sorted rows
            tbody.innerHTML = '';
            rows.forEach(row => tbody.appendChild(row));
          }

          // Report Modal Functions
          let currentReportIndex = 0;

          function openReportModal(index) {
            currentReportIndex = index;
            const modal = document.getElementById('reportModal');
            const totalReports = parseInt(modal.getAttribute('data-total-reports') || '0');
            const reportBody = document.getElementById('reportModalBody');
            const reportTitle = document.getElementById('reportModalTitle');
            const prevBtn = document.getElementById('prevReportBtn');
            const nextBtn = document.getElementById('nextReportBtn');

            // Get the report content
            const reportElement = document.getElementById('facility-' + index);
            if (reportElement) {
              reportBody.innerHTML = reportElement.innerHTML;

              // Update title with facility name
              const facilityRows = document.querySelectorAll('.facility-row');
              const facilityRow = facilityRows[index];
              const facilityName = facilityRow.querySelector('.facility-name').textContent;
              reportTitle.textContent = facilityName;

              // Update navigation buttons
              prevBtn.disabled = index === 0;
              nextBtn.disabled = index === totalReports - 1;

              modal.classList.add('active');
              reportBody.scrollTop = 0;
            }
          }

          function closeReportModal() {
            const modal = document.getElementById('reportModal');
            modal.classList.remove('active');
          }

          function navigateReport(direction) {
            const modal = document.getElementById('reportModal');
            const totalReports = parseInt(modal.getAttribute('data-total-reports') || '0');
            const newIndex = currentReportIndex + direction;
            if (newIndex >= 0 && newIndex < totalReports) {
              openReportModal(newIndex);
            }
          }

          function scrollToTop() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }

          window.addEventListener('scroll', function() {
            const backToTopBtn = document.getElementById('backToTop');
            if (backToTopBtn) {
              if (window.pageYOffset > 300) {
                backToTopBtn.style.display = 'block';
              } else {
                backToTopBtn.style.display = 'none';
              }
            }
          });

          // Initialize default sort (by name) on page load
          document.addEventListener('DOMContentLoaded', function() {
            sortFacilities('name');
          });
        </script>
      </body>
      </html>
    `;

    const blob = new Blob([fullHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = combinedReport && selectedInspectionsList.length > 1
      ? `SPCC_Combined_Report_${selectedInspectionsList.length}_Facilities_${new Date().toISOString().split('T')[0]}.html`
      : `SPCC_Inspection_Reports_${new Date().toISOString().split('T')[0]}.html`;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (field: 'date' | 'facility' | 'flagged') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const filteredAndSortedInspections = inspections
    .filter((inspection) => {
      if (!searchQuery) return true;
      const facility = facilities.find(f => f.id === inspection.facility_id);
      const searchLower = searchQuery.toLowerCase();
      return (
        facility?.name.toLowerCase().includes(searchLower) ||
        inspection.inspector_name.toLowerCase().includes(searchLower) ||
        new Date(inspection.conducted_at).toLocaleDateString().includes(searchLower)
      );
    })
    .sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'date') {
        comparison = new Date(a.conducted_at).getTime() - new Date(b.conducted_at).getTime();
      } else if (sortBy === 'facility') {
        const facilityA = facilities.find(f => f.id === a.facility_id)?.name || '';
        const facilityB = facilities.find(f => f.id === b.facility_id)?.name || '';
        comparison = facilityA.localeCompare(facilityB);
      } else if (sortBy === 'flagged') {
        comparison = a.flagged_items_count - b.flagged_items_count;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-3">
        <Loader className="w-6 h-6 animate-spin text-blue-600" />
        {loadingProgress.total > 0 && (
          <div className="w-full max-w-xs">
            <div className="text-sm text-gray-600 dark:text-gray-400 text-center mb-2">
              Loading photos: {loadingProgress.current} / {loadingProgress.total}
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (inspections.length === 0) {
    return (
      <div className="text-center py-8 text-gray-600 dark:text-gray-400">
        <FileText className="w-12 h-12 mx-auto mb-3 text-gray-400 dark:text-gray-600" />
        <p>No completed inspections to export</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg transition-colors duration-200">
        <p className="text-sm text-blue-900 dark:text-blue-100">
          <span className="font-semibold">{facilities.length}</span> facilities in route
        </p>
        <p className="text-sm text-blue-900 dark:text-blue-100">
          <span className="font-semibold">{filteredAndSortedInspections.length}</span> of <span className="font-semibold">{inspections.length}</span> inspections shown
        </p>
      </div>

      <div className="mb-3 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          placeholder="Search by facility, inspector, or date..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 transition-colors duration-200"
        />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-gray-600 dark:text-gray-400">Sort by:</span>
        <button
          onClick={() => toggleSort('date')}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
            sortBy === 'date'
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Date
          {sortBy === 'date' && <ArrowUpDown className="w-3 h-3" />}
        </button>
        <button
          onClick={() => toggleSort('facility')}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
            sortBy === 'facility'
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Facility
          {sortBy === 'facility' && <ArrowUpDown className="w-3 h-3" />}
        </button>
        <button
          onClick={() => toggleSort('flagged')}
          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
            sortBy === 'flagged'
              ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Flagged
          {sortBy === 'flagged' && <ArrowUpDown className="w-3 h-3" />}
        </button>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={selectAll}
          className="px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
        >
          Select All
        </button>
        <button
          onClick={clearAll}
          className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        >
          Clear All
        </button>
      </div>

      <div className="space-y-2 mb-4 max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-2 bg-white dark:bg-gray-800 transition-colors duration-200">
        {filteredAndSortedInspections.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p className="text-sm">No inspections match your search</p>
          </div>
        ) : (
          filteredAndSortedInspections.map((inspection) => {
          const facility = facilities.find(f => f.id === inspection.facility_id);
          return (
            <label
              key={inspection.id}
              className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer bg-white dark:bg-gray-800 transition-colors duration-200"
            >
              <input
                type="checkbox"
                checked={selectedInspections.has(inspection.id)}
                onChange={() => toggleInspection(inspection.id)}
                className="w-3 h-3"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">{facility?.name || 'Unknown Facility'}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {new Date(inspection.conducted_at).toLocaleDateString()} - {inspection.inspector_name}
                </p>
              </div>
              {inspection.flagged_items_count > 0 && (
                <span className="text-xs bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200 px-2 py-1 rounded">
                  {inspection.flagged_items_count} flagged
                </span>
              )}
            </label>
          );
        })
        )}
      </div>

      <div className={`mb-4 p-4 rounded-lg border transition-all duration-200 ${
        selectedInspections.size > 1
          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700'
          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 opacity-60'
      }`}>
        <label className={`flex items-start gap-3 ${selectedInspections.size > 1 ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
          <input
            type="checkbox"
            checked={combinedReport && selectedInspections.size > 1}
            onChange={(e) => setCombinedReport(e.target.checked)}
            disabled={selectedInspections.size < 2}
            className="mt-1 w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex-1">
            <div className={`font-medium ${
              selectedInspections.size > 1
                ? 'text-blue-900 dark:text-blue-100'
                : 'text-gray-600 dark:text-gray-400'
            }`}>
              Create Combined Report {selectedInspections.size > 1 && '✨'}
            </div>
            <div className={`text-sm mt-1 ${
              selectedInspections.size > 1
                ? 'text-blue-700 dark:text-blue-200'
                : 'text-gray-500 dark:text-gray-500'
            }`}>
              {selectedInspections.size > 1
                ? 'Generate a single report with a summary dashboard and easy navigation between facilities. Perfect for reviewing multiple inspections at once.'
                : selectedInspections.size === 1
                ? 'Select at least one more inspection to create a combined report with summary dashboard.'
                : 'Select 2 or more inspections to enable combined report mode.'}
            </div>
          </div>
        </label>
      </div>

      <button
        onClick={exportReports}
        disabled={selectedInspections.size === 0}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 dark:bg-green-700 text-white rounded-md hover:bg-green-700 dark:hover:bg-green-600 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors font-medium"
      >
        <Download className="w-5 h-5" />
        {combinedReport && selectedInspections.size > 1
          ? `Export Combined Report (${selectedInspections.size} Facilities)`
          : `Export ${selectedInspections.size} Report${selectedInspections.size !== 1 ? 's' : ''}`} (HTML)
      </button>
      <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 text-center">
        Download as HTML file, then open in browser and print to PDF
      </p>
    </div>
  );
}
