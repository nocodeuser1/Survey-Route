import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  X,
  FileSpreadsheet,
  FileText,
  Download,
  ShieldCheck,
  Route,
  Loader2,
  Printer,
} from 'lucide-react';
import ModalPortal from './ModalPortal';
import {
  supabase,
  type Facility,
  type LDARSurvey,
  type LDARLeak,
  type LDAREquipmentCertification,
} from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { useFacilityIdLabel } from '../hooks/useFacilityIdLabel';
import {
  getFacilityLdarCompliance,
  LDAR_FREQUENCY_LABELS,
  estimateLeakEmissions,
  getLeakStatusMeta,
} from '../utils/ldar';

interface LDARReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  scopedFacilities: Facility[];
  usingSelection: boolean;
  accountId: string;
  isBulkDownloading?: boolean;
  onBulkDownloadPaths?: () => void;
  onBulkDownloadPlans?: () => void;
}

type GeneralReportKind =
  | 'survey_master'
  | 'leak_master'
  | 'dor_log'
  | 'leak_punchlist'
  | 'equipment_qa'
  | 'survey_summary';

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function LDARReportsModal({
  isOpen,
  onClose,
  scopedFacilities,
  usingSelection,
  accountId,
  isBulkDownloading = false,
  onBulkDownloadPaths,
  onBulkDownloadPlans,
}: LDARReportsModalProps) {
  const { darkMode } = useDarkMode();
  const facilityIdLabel = useFacilityIdLabel();

  const currentYear = new Date().getFullYear();
  const [reportingYear, setReportingYear] = useState<number>(currentYear);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv' | 'html'>('xlsx');
  const [surveys, setSurveys] = useState<LDARSurvey[]>([]);
  const [leaks, setLeaks] = useState<LDARLeak[]>([]);
  const [equipment, setEquipment] = useState<LDAREquipmentCertification[]>([]);
  const [companyName, setCompanyName] = useState('Operator');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !accountId) return;
    setLoading(true);
    Promise.all([
      supabase.from('ldar_surveys').select('*').eq('account_id', accountId).order('survey_date', { ascending: false }),
      supabase.from('ldar_leaks').select('*').eq('account_id', accountId).order('detected_at', { ascending: false }),
      supabase.from('ldar_equipment_certifications').select('*').eq('account_id', accountId),
      supabase.from('accounts').select('company_name, account_name').eq('id', accountId).maybeSingle(),
    ])
      .then(([sRes, lRes, eRes, aRes]) => {
        if (sRes.data) setSurveys(sRes.data as LDARSurvey[]);
        if (lRes.data) setLeaks(lRes.data as LDARLeak[]);
        if (eRes.data) setEquipment(eRes.data as LDAREquipmentCertification[]);
        if (aRes.data) setCompanyName(aRes.data.company_name || aRes.data.account_name || 'Operator');
      })
      .finally(() => setLoading(false));
  }, [isOpen, accountId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  const scopedIds = useMemo(() => new Set(scopedFacilities.map(f => f.id)), [scopedFacilities]);
  const facMap = useMemo(() => new Map(scopedFacilities.map(f => [f.id, f])), [scopedFacilities]);

  const scopedSurveys = useMemo(
    () => surveys.filter(s => scopedIds.has(s.facility_id)),
    [surveys, scopedIds],
  );
  const scopedLeaks = useMemo(
    () => leaks.filter(l => scopedIds.has(l.facility_id)),
    [leaks, scopedIds],
  );

  if (!isOpen) return null;

  const pathPdfCount = scopedFacilities.filter(
    f => f.ldar_observation_path_data?.annotated_pdf_url,
  ).length;
  const sitePlanPdfCount = scopedFacilities.filter(f => f.ldar_site_plan_url).length;

  // Regulatory EPA CEDRI Export (OOOOa: Aug 2 prevYr – Aug 1 yr | OOOOb: May 7 prevYr – May 6 yr)
  const handleExportCedriWorkbook = (rule: 'OOOOa' | 'OOOOb' | 'SubpartW') => {
    const startIso =
      rule === 'OOOOa'
        ? `${reportingYear - 1}-08-02`
        : rule === 'OOOOb'
          ? `${reportingYear - 1}-05-07`
          : `${reportingYear}-01-01`;
    const endIso =
      rule === 'OOOOa'
        ? `${reportingYear}-08-01`
        : rule === 'OOOOb'
          ? `${reportingYear}-05-06`
          : `${reportingYear}-12-31`;

    const periodSurveys = scopedSurveys.filter(
      s => s.survey_date >= startIso && s.survey_date <= endIso,
    );
    const periodLeaks = scopedLeaks.filter(
      l => l.detected_at >= startIso && l.detected_at <= endIso,
    );

    const wb = XLSX.utils.book_new();

    // Sheet 1: Facility Information
    const facRows = scopedFacilities.map(f => {
      const comp = getFacilityLdarCompliance(f);
      return {
        Operator_Name: companyName,
        Reporting_Program: `EPA NSPS ${rule}`,
        Reporting_Period_Start: startIso,
        Reporting_Period_End: endIso,
        Facility_Name: f.name,
        [facilityIdLabel.long.replace(/\s+/g, '_')]: f.camino_facility_id || '',
        County: f.county || '',
        State: f.state_code || '',
        Latitude: f.latitude ?? '',
        Longitude: f.longitude ?? '',
        First_Production_Date: f.first_prod_date || '',
        Facility_Type: f.ldar_facility_type || 'Well Site',
        Survey_Frequency: LDAR_FREQUENCY_LABELS[comp.frequency],
        Primary_Method: comp.method,
        Planned_Shutdown_Date: f.ldar_planned_shutdown_date || '',
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(facRows), '1_Facility_Info');

    // Sheet 2: Fugitive Emissions Surveys
    const surveyRows = periodSurveys.map(s => {
      const f = facMap.get(s.facility_id);
      return {
        Facility_Name: f?.name || '',
        Facility_ID: f?.camino_facility_id || '',
        Sub_Facility: s.sub_facility_name || 'Whole Site',
        Survey_Date: s.survey_date,
        Method: s.survey_method,
        Reason: s.survey_reason,
        Lead_Inspector: s.inspector_name,
        Instrument_Model: s.camera_model || '',
        Instrument_Serial: s.camera_serial || '',
        Temp_Start_F: s.temp_start_f ?? '',
        Temp_End_F: s.temp_end_f ?? '',
        Wind_Avg_MPH: s.wind_speed_avg_mph ?? '',
        Wind_Max_MPH: s.wind_speed_max_mph ?? '',
        Sky_Conditions: s.sky_conditions || '',
        Leaks_Found: s.leaks_found_count,
        Deviated_From_Plan: s.deviated_from_plan ? 'YES' : 'NO',
        Deviation_Justification: s.deviation_justification || '',
      };
    });
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(surveyRows.length ? surveyRows : [{ Note: `No surveys logged in ${startIso} to ${endIso}` }]),
      '2_Fugitive_Surveys',
    );

    // Sheet 3: Leaks & Repairs
    const leakRows = periodLeaks.map(l => {
      const f = facMap.get(l.facility_id);
      const em = estimateLeakEmissions({
        componentType: l.component_type,
        flowRateValue: l.flow_rate_value,
        flowRateUnit: l.flow_rate_unit,
      });
      return {
        Facility_Name: f?.name || '',
        Leak_Tag_ID: l.leak_tag_id,
        Date_Detected: l.detected_at,
        Detection_Method: l.detection_method,
        Equipment_Unit: l.equipment_unit || '',
        Component_Type: l.component_type,
        Component_SubType: l.component_subtype || '',
        Size: l.component_size || '',
        Stream: l.gas_stream_type || '',
        Status: getLeakStatusMeta(l.status).label,
        First_Attempt_Due: l.faar_due_date || '',
        First_Attempt_Date: l.first_attempt_date || '',
        Final_Repair_Due: l.final_repair_due_date || '',
        Repaired_Date: l.repaired_date || '',
        Repair_Method: l.repair_method || '',
        Confirmed_Date: l.confirmed_date || '',
        Confirmation_Method: l.confirmation_method || '',
        Confirmation_Reading: l.confirmation_reading ?? '',
        Est_Flow_SCFH: em.scfh,
        Est_MT_CO2e_Yr: em.mtCo2ePerYear,
      };
    });
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(leakRows.length ? leakRows : [{ Note: 'Zero fugitive leaks recorded in reporting window' }]),
      '3_Leaks_And_Repairs',
    );

    // Sheet 4: Delay of Repair (DOR) active during the reporting period
    const dorRows = scopedLeaks
      .filter(
        l =>
          l.dor_status !== 'none' &&
          l.detected_at <= endIso &&
          (!l.confirmed_date || l.confirmed_date >= startIso),
      )
      .map(l => ({
        Facility_Name: facMap.get(l.facility_id)?.name || '',
        Leak_Tag_ID: l.leak_tag_id,
        Component_Type: l.component_type,
        Date_Detected: l.detected_at,
        DOR_Status: l.dor_status.toUpperCase(),
        Reason_Code: l.dor_reason_code || '',
        Technical_Justification: l.dor_justification || '',
        Parts_PO_Number: l.dor_parts_order_number || '',
        Parts_ETA: l.dor_parts_eta || '',
        Planned_Shutdown_FSD: l.dor_planned_shutdown_date || '',
        Extended_Deadline: l.dor_extended_due_date || '',
        Reviewed_By: l.dor_reviewed_by || '',
      }));
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(dorRows.length ? dorRows : [{ Note: 'No Delay of Repair (DOR) components' }]),
      '4_Delay_Of_Repair',
    );

    // Sheet 5: Deviations & Appendix K QA
    if (rule === 'OOOOb') {
      const qaRows = periodSurveys.map(s => ({
        Survey_Date: s.survey_date,
        Facility_Name: facMap.get(s.facility_id)?.name || '',
        Inspector: s.inspector_name,
        Camera_Model: s.camera_model || '',
        Camera_Serial: s.camera_serial || '',
        Daily_QA_Passed: s.daily_qa_completed ? 'PASS' : 'FAIL',
        QA_Mode: s.daily_qa_mode || 'operating_envelope',
        Delta_T_F: s.delta_t_f ?? '',
        Max_Viewing_Dist_Ft: s.max_viewing_distance_ft ?? '',
        QA_Flow_Rate_g_hr: s.qa_gas_flow_rate_ghr ?? '',
        QA_Video_Ref: s.qa_video_reference || '',
      }));
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(qaRows.length ? qaRows : [{ Note: 'No OGI QA records in period' }]),
        '5_Appendix_K_Camera_QA',
      );
    }

    const fileName = `EPA_${rule}_CEDRI_Report_${reportingYear}_${companyName.replace(/\s+/g, '_')}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Operational General Reports Exporter
  const handleExportGeneralReport = (kind: GeneralReportKind) => {
    let title = '';
    let rows: Array<Record<string, unknown>> = [];

    if (kind === 'survey_master') {
      title = 'LDAR_Survey_Master_Log';
      rows = scopedSurveys.map(s => {
        const f = facMap.get(s.facility_id);
        return {
          Survey_Date: s.survey_date,
          Facility_Name: f?.name || '',
          Facility_ID: f?.camino_facility_id || '',
          Method: s.survey_method,
          Reason: s.survey_reason,
          Status: s.status,
          Inspector: s.inspector_name,
          Camera_Model: s.camera_model || '',
          Camera_Serial: s.camera_serial || '',
          Temp_Start_F: s.temp_start_f ?? '',
          Temp_End_F: s.temp_end_f ?? '',
          Wind_Avg_MPH: s.wind_speed_avg_mph ?? '',
          Wind_Max_MPH: s.wind_speed_max_mph ?? '',
          Sky: s.sky_conditions || '',
          Daily_QA_Passed: s.daily_qa_completed ? 'Yes' : 'No',
          Leaks_Found: s.leaks_found_count,
          Notes: s.notes || '',
        };
      });
    } else if (kind === 'leak_master' || kind === 'leak_punchlist') {
      title = kind === 'leak_punchlist' ? 'LDAR_Open_Leak_Repair_Punchlist' : 'LDAR_Leak_Master_History';
      const source = kind === 'leak_punchlist' ? scopedLeaks.filter(l => l.status !== 'repaired') : scopedLeaks;
      rows = source.map(l => {
        const f = facMap.get(l.facility_id);
        return {
          Leak_Tag_ID: l.leak_tag_id,
          Facility_Name: f?.name || '',
          Facility_ID: f?.camino_facility_id || '',
          Stage: getLeakStatusMeta(l.status).label,
          Detected_Date: l.detected_at,
          Equipment_Unit: l.equipment_unit || '',
          Component_Type: l.component_type,
          Sub_Type: l.component_subtype || '',
          Size: l.component_size || '',
          Location_Description: l.location_description || '',
          FAAR_Due: l.faar_due_date || '',
          Final_Repair_Due: l.final_repair_due_date || '',
          Confirmation_Due: l.confirmation_due_date || '',
          Repaired_Date: l.repaired_date || '',
          Confirmed_Date: l.confirmed_date || '',
          Latitude: l.latitude ?? f?.latitude ?? '',
          Longitude: l.longitude ?? f?.longitude ?? '',
        };
      });
    } else if (kind === 'dor_log') {
      title = 'LDAR_Delay_Of_Repair_Log';
      rows = scopedLeaks
        .filter(l => l.dor_status !== 'none')
        .map(l => ({
          Leak_Tag_ID: l.leak_tag_id,
          Facility_Name: facMap.get(l.facility_id)?.name || '',
          DOR_Status: l.dor_status.toUpperCase(),
          Reason_Code: l.dor_reason_code || '',
          Justification: l.dor_justification || '',
          Parts_Order_Number: l.dor_parts_order_number || '',
          Parts_ETA: l.dor_parts_eta || '',
          Planned_Shutdown_FSD: l.dor_planned_shutdown_date || '',
          Extended_Due_Date: l.dor_extended_due_date || '',
          Reviewed_By: l.dor_reviewed_by || '',
        }));
    } else if (kind === 'equipment_qa') {
      title = 'LDAR_Equipment_And_QA_Verification_Log';
      rows = equipment.map(eq => ({
        Category: eq.item_category,
        Name: eq.name,
        Model: eq.model || '',
        Serial_Number: eq.serial_number || '',
        Assigned_To: eq.assigned_to || '',
        Expiration_Date: eq.expiration_date || '',
        Last_Daily_QA_Verified: eq.daily_qa_verified_date || '',
        Status: eq.status,
      }));
    } else {
      title = 'LDAR_Survey_Schedule_Compliance_Summary';
      rows = scopedFacilities.map(f => {
        const comp = getFacilityLdarCompliance(f);
        return {
          Facility_Name: f.name,
          Facility_ID: f.camino_facility_id || '',
          County: f.county || '',
          Frequency: LDAR_FREQUENCY_LABELS[comp.frequency],
          Method: comp.method,
          Schedule_Status: comp.label,
          Last_Survey_Date: comp.lastSurveyDate || '',
          Earliest_Window_Start: comp.windowStartDate || '',
          Next_Hard_Due_Date: comp.nextDueDate || '',
          Days_Remaining: comp.daysUntilDue ?? '',
          Open_Leaks: comp.openLeaksCount,
          DOR_Leaks: comp.dorLeaksCount,
          Site_Plan_Status: comp.sitePlanState,
        };
      });
    }

    if (rows.length === 0) {
      rows = [{ Status: 'No records found matching current scope' }];
    }

    if (exportFormat === 'html') {
      const headers = Object.keys(rows[0]);
      const safeTitle = escapeHtml(title.replace(/_/g, ' '));
      const safeCompany = escapeHtml(companyName);
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 32px; color: #111827; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 18px; }
    .print-btn { background: #0f766e; color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .print-btn:hover { background: #115e59; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    p { font-size: 12px; color: #6b7280; margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #0f766e; color: #fff; text-align: left; padding: 8px; }
    td { border-bottom: 1px solid #e5e7eb; padding: 7px 8px; }
    tr:nth-child(even) td { background: #f9fafb; }
    @media print { body { padding: 0; } .print-btn { display: none; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <div>
      <h1>${safeCompany} — ${safeTitle}</h1>
      <p>Generated ${escapeHtml(new Date().toLocaleString())} · Scope: ${scopedFacilities.length} facilities</p>
    </div>
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <table>
    <thead><tr>${headers.map(h => `<th>${escapeHtml(h.replace(/_/g, ' '))}</th>`).join('')}</tr></thead>
    <tbody>
      ${rows
        .map(r => `<tr>${headers.map(h => `<td>${escapeHtml(r[h])}</td>`).join('')}</tr>`)
        .join('')}
    </tbody>
  </table>
</body>
</html>`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${title}.html`;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    if (exportFormat === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      XLSX.writeFile(wb, `${title}.xlsx`);
    }
  };

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="LDAR Regulatory and Operational Reports"
        className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className={`relative w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border ${
            darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
          }`}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${
              darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">LDAR Regulatory & Operational Reports</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300">
                  {usingSelection
                    ? `${scopedFacilities.length} selected`
                    : `${scopedFacilities.length} facilities`}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Export EPA CEDRI multi-sheet annual workbooks, operational logs, and site walking paths
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {loading ? (
              <div className="py-12 text-center text-gray-500">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-teal-600" />
                <span className="text-xs">Preparing LDAR report datasets...</span>
              </div>
            ) : (
              <>
                {/* 1. EPA CEDRI Regulatory Reports */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4" />
                      EPA CEDRI Regulatory Compliance Workbooks (.xlsx)
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Reporting Year:</span>
                      <select
                        value={reportingYear}
                        onChange={e => setReportingYear(Number(e.target.value))}
                        className="px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-semibold"
                      >
                        {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map(yr => (
                          <option key={yr} value={yr}>
                            {yr}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => handleExportCedriWorkbook('OOOOb')}
                      className="p-3.5 rounded-xl border border-teal-200 dark:border-teal-800 hover:bg-teal-50/60 dark:hover:bg-teal-900/20 text-left transition-colors"
                    >
                      <FileSpreadsheet className="w-5 h-5 text-teal-600 dark:text-teal-400 mb-1.5" />
                      <div className="text-sm font-bold">NSPS OOOOb Annual</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        Period: May 7, {reportingYear - 1} – May 6, {reportingYear} + Appendix K QA
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportCedriWorkbook('OOOOa')}
                      className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-800 hover:bg-blue-50/60 dark:hover:bg-blue-900/20 text-left transition-colors"
                    >
                      <FileSpreadsheet className="w-5 h-5 text-blue-600 dark:text-blue-400 mb-1.5" />
                      <div className="text-sm font-bold">NSPS OOOOa Annual</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        Period: Aug 2, {reportingYear - 1} – Aug 1, {reportingYear} (4 CEDRI tabs)
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportCedriWorkbook('SubpartW')}
                      className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 hover:bg-amber-50/60 dark:hover:bg-amber-900/20 text-left transition-colors"
                    >
                      <FileSpreadsheet className="w-5 h-5 text-amber-600 dark:text-amber-400 mb-1.5" />
                      <div className="text-sm font-bold">EPA Subpart W GHG</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        CY {reportingYear} fugitive scfh & MT CO2e summary
                      </div>
                    </button>
                  </div>
                </div>

                {/* 2. Operational General Reports */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Operational LDAR Logs & Management Reports
                    </h3>
                    <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-gray-100 dark:bg-gray-800">
                      {(
                        [
                          { id: 'xlsx', label: 'Excel (.xlsx)' },
                          { id: 'csv', label: 'CSV' },
                          { id: 'html', label: 'Print / PDF' },
                        ] as const
                      ).map(fmt => (
                        <button
                          key={fmt.id}
                          type="button"
                          onClick={() => setExportFormat(fmt.id)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                            exportFormat === fmt.id
                              ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                              : 'text-gray-500'
                          }`}
                        >
                          {fmt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(
                      [
                        {
                          id: 'survey_summary',
                          title: 'Survey Schedule Compliance Summary',
                          desc: 'Windows, next hard due dates & site readiness across all facilities',
                        },
                        {
                          id: 'survey_master',
                          title: 'Survey Master & Weather Log',
                          desc: `${scopedSurveys.length} logged surveys with camera QA & start/end weather`,
                        },
                        {
                          id: 'leak_punchlist',
                          title: 'Open Leak Field Repair Punchlist',
                          desc: `${scopedLeaks.filter(l => l.status !== 'repaired').length} open leaks sorted for maintenance crews`,
                        },
                        {
                          id: 'leak_master',
                          title: 'Leak Master Lifecycle Log',
                          desc: `${scopedLeaks.length} total leaks with FAAR, repair attempts & confirmations`,
                        },
                        {
                          id: 'dor_log',
                          title: 'Delay of Repair (DOR) Audit Report',
                          desc: 'Justifications, PO numbers, FSD dates & admin approval sign-offs',
                        },
                        {
                          id: 'equipment_qa',
                          title: 'Camera & Verification Check Log',
                          desc: `${equipment.length} OGI instruments, calibration gas & operator certs`,
                        },
                      ] as const
                    ).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleExportGeneralReport(item.id)}
                        className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 flex items-start justify-between gap-2 text-left transition-colors"
                      >
                        <div>
                          <div className="text-sm font-semibold">{item.title}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {item.desc}
                          </div>
                        </div>
                        {exportFormat === 'html' ? (
                          <Printer className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                        ) : (
                          <Download className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Site Walking Path & Site Plan PDFs (ZIP) */}
                {(onBulkDownloadPaths || onBulkDownloadPlans) && (
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      LDAR Site Plans & Walking Path Bundles (ZIP)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {onBulkDownloadPaths && (
                        <button
                          type="button"
                          disabled={isBulkDownloading || pathPdfCount === 0}
                          onClick={() => {
                            onClose();
                            onBulkDownloadPaths();
                          }}
                          className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-400 flex items-center gap-3 text-left disabled:opacity-50"
                        >
                          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600">
                            <Route className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Observation Path PDFs (ZIP)</div>
                            <div className="text-xs text-gray-500">
                              {pathPdfCount} annotated walking-path PDFs ready
                            </div>
                          </div>
                        </button>
                      )}
                      {onBulkDownloadPlans && (
                        <button
                          type="button"
                          disabled={isBulkDownloading || sitePlanPdfCount === 0}
                          onClick={() => {
                            onClose();
                            onBulkDownloadPlans();
                          }}
                          className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-400 flex items-center gap-3 text-left disabled:opacity-50"
                        >
                          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">Source Site Plans (ZIP)</div>
                            <div className="text-xs text-gray-500">
                              {sitePlanPdfCount} source site-plan PDFs uploaded
                            </div>
                          </div>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
