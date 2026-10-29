// HTML for the bulk "Export Inspection Reports" download (ExportSurveys).
// Pure so it can be tested without a browser: callers load the template,
// the inspections and their photos (photo_url already a data/signed URL).

import { escapeHtml } from './escapeHtml.ts';
import { groupResponseEvents, reportableEvents, type InspectionEvent } from './inspectionEvents.ts';

export interface ExportQuestion {
  id: string;
  text: string;
  type?: string;
}

export interface ExportResponse {
  question_id: string;
  answer: 'yes' | 'no' | 'na' | null;
  comments?: string | null;
  action_required?: boolean;
  action_notes?: string | null;
  events?: InspectionEvent[] | null;
}

export interface ExportInspection {
  id: string;
  facility_id: string;
  conducted_at: string;
  inspector_name?: string | null;
  inspector_email?: string | null;
  responses?: ExportResponse[] | null;
  signature_data?: string | null;
}

export interface ExportFacility {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

export interface ExportPhoto {
  id: string;
  question_id: string;
  /** A data: or signed URL; photos that failed to load should be left out. */
  photo_url: string;
}

const ANSWER_LABEL: Record<string, string> = { yes: 'Yes', no: 'No', na: 'N/A' };

function renderQuestion(question: ExportQuestion, response: ExportResponse, photos: ExportPhoto[]): string {
  const events = reportableEvents(groupResponseEvents(response, photos));
  const numbered = events.length > 1;
  const eventsHtml = events.map((event, index) => {
    if (!numbered && !event.description && event.photos.length === 0) return '';
    return `
      <div class="event">
        ${numbered ? `<div class="event-label">Event ${index + 1}</div>` : ''}
        ${event.description ? `<div class="notes">${escapeHtml(event.description)}</div>` : ''}
        ${event.photos.length > 0 ? `<div class="photos">${event.photos.map((photo, photoIndex) => `
          <img src="${escapeHtml(photo.photo_url)}" alt="${numbered ? `Event ${index + 1} photo` : 'Inspection photo'} ${photoIndex + 1}" class="photo" />`).join('')}
        </div>` : ''}
      </div>`;
  }).join('');
  const isComment = question.type === 'comment';
  const answer = response.answer ?? '';
  const statusClass = isComment ? '' : answer === 'no' ? 'non-compliant' : answer === 'yes' ? 'compliant' : '';
  const showAction = response.answer === 'no' && !!response.action_required;
  return `
    <div class="item ${statusClass}">
      <div class="item-head">
        <strong>${escapeHtml(question.text)}</strong>
        ${isComment ? '' : `<span class="answer answer-${escapeHtml(answer || 'none')}">${escapeHtml(ANSWER_LABEL[answer] ?? 'N/A')}</span>`}
      </div>
      ${eventsHtml}
      ${showAction ? `<div class="action"><em>Action Required</em>${response.action_notes ? `: ${escapeHtml(response.action_notes)}` : ''}</div>` : ''}
    </div>`;
}

export function renderInspectionSection(
  inspection: ExportInspection,
  facility: ExportFacility,
  questions: readonly ExportQuestion[],
  photos: readonly ExportPhoto[],
): string {
  const conductedDate = new Date(inspection.conducted_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
  const responses = inspection.responses ?? [];
  const photosByQuestion = new Map<string, ExportPhoto[]>();
  for (const photo of photos) {
    photosByQuestion.set(photo.question_id, [...(photosByQuestion.get(photo.question_id) ?? []), photo]);
  }
  const items = questions.map((question) => {
    const response = responses.find((r) => r.question_id === question.id);
    return response ? renderQuestion(question, response, photosByQuestion.get(question.id) ?? []) : '';
  }).join('');

  return `
    <div class="inspection-report">
      <div class="header">
        <h1>SPCC Inspection Report</h1>
        <h2>${escapeHtml(facility.name)}</h2>
        <p>${escapeHtml(facility.address || 'No address provided')}</p>
        <p>Inspection Date: ${escapeHtml(conductedDate)}</p>
      </div>

      <div class="section">
        <div class="section-title">Facility Information</div>
        <table>
          <tr><td><strong>Name:</strong></td><td>${escapeHtml(facility.name)}</td></tr>
          <tr><td><strong>Address:</strong></td><td>${escapeHtml(facility.address || 'N/A')}</td></tr>
          <tr><td><strong>Coordinates:</strong></td><td>${escapeHtml(`${facility.latitude ?? ''}, ${facility.longitude ?? ''}`)}</td></tr>
          <tr><td><strong>Inspector:</strong></td><td>${escapeHtml(inspection.inspector_name)}${inspection.inspector_email ? ` (${escapeHtml(inspection.inspector_email)})` : ''}</td></tr>
        </table>
      </div>

      <div class="section">
        <div class="section-title">Inspection Items</div>
        ${items || '<p>No responses recorded.</p>'}
      </div>

      ${inspection.signature_data ? `
        <div class="signature">
          <p><strong>Inspector Signature:</strong></p>
          <img src="${escapeHtml(inspection.signature_data)}" alt="Signature" style="max-width: 160px; max-height: 80px;" />
          <p>${escapeHtml(inspection.inspector_name)}${inspection.inspector_email ? `<br>${escapeHtml(inspection.inspector_email)}` : ''}</p>
          <p>Date: ${escapeHtml(conductedDate)}</p>
        </div>
      ` : ''}
    </div>`;
}

export function buildSurveysExportHtml(options: {
  title: string;
  inspections: readonly ExportInspection[];
  facilities: readonly ExportFacility[];
  questions: readonly ExportQuestion[];
  photosByInspection: ReadonlyMap<string, readonly ExportPhoto[]>;
}): string {
  const sections = options.inspections.map((inspection) => {
    const facility = options.facilities.find((f) => f.id === inspection.facility_id);
    if (!facility) return '';
    return renderInspectionSection(inspection, facility, options.questions, options.photosByInspection.get(inspection.id) ?? []);
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(options.title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .inspection-report { page-break-after: always; margin-bottom: 40px; border: 1px solid #ddd; padding: 20px; }
    .header { text-align: center; margin-bottom: 20px; }
    .section { margin: 20px 0; }
    .section-title { font-weight: bold; font-size: 14px; margin-bottom: 10px; color: #333; }
    .item { margin: 10px 0; padding: 10px; border-left: 3px solid #ddd; page-break-inside: avoid; }
    .item-head { display: flex; justify-content: space-between; gap: 12px; }
    .compliant { border-left-color: #10b981; }
    .non-compliant { border-left-color: #ef4444; }
    .answer { font-weight: bold; white-space: nowrap; }
    .answer-yes { color: #059669; }
    .answer-no { color: #dc2626; }
    .answer-na, .answer-none { color: #6b7280; }
    .event { margin-top: 8px; page-break-inside: avoid; }
    .event-label { font-size: 12px; font-weight: bold; color: #4b5563; text-transform: uppercase; }
    .notes { white-space: pre-wrap; margin-top: 4px; }
    .photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .photo { width: 160px; height: 120px; object-fit: cover; border: 1px solid #ddd; page-break-inside: avoid; }
    .action { margin-top: 6px; color: #b45309; }
    .signature { margin-top: 30px; border-top: 1px solid #000; padding-top: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    td { padding: 5px; }
  </style>
</head>
<body>
${sections}
</body>
</html>`;
}
