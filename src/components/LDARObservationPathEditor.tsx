import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  X,
  Sparkles,
  Pencil,
  Eye,
  Save,
  Undo2,
  Redo2,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Route,
  Scissors,
  CalendarPlus,
  Files,
} from 'lucide-react';
import {
  supabase,
  type Facility,
  type LDARObservationPathData,
  type LDARObservationPathStop,
  type LDARObservationPathWaypoint,
  type LDARCustomTextBox,
} from '../lib/supabase';
import { renderPdfPageToImage } from '../utils/renderPdfPageToImage';
import {
  findTextInPdfPage,
  findDateInPdfPage,
  type TextBoundingBox,
} from '../utils/findTextInPdfPage';
import { svgToPdfBlob } from '../utils/svgToPdfBlob';
import { buildLdarSitePlanFilename } from '../utils/ldar';
import { detectSitePlanInLoadedPdf } from '../utils/spccSitePlanDetector';
import { extractPageAsPdf } from '../utils/extractPdfPage';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { pdfjsDocumentDefaults } from '../utils/pdfjsDocumentDefaults';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

/**
 * LDAR Observation Path Editor
 *
 * Full-screen modal for generating + editing the walking-path overlay drawn
 * on top of a facility's LDAR site plan PDF. The overlay is SVG, positioned
 * over a rendered PNG of page 1 of the PDF. All coords stored as 0..1
 * normalized so the overlay scales cleanly at any size.
 *
 * Three editable element types — and ONLY these:
 *   1. Numbered stops (red circle + white border + white number)
 *   2. The walking path (yellow dotted curve through stops + waypoints)
 *   3. The legend (white box with red border)
 *
 * Everything else (equipment callouts, the aerial photo) is part of the
 * source PDF and not touched here.
 *
 * Interactions:
 *   - Click + drag a stop → moves it (and the path follows).
 *   - Double-click a stop → inline edit the stop's NUMBER (the legend
 *     reorders by ascending number).
 *   - Click a stop once → selects it, exposes a delete button + a
 *     "rename label" input in the toolbar.
 *   - Click + drag a path waypoint → bends the curve.
 *   - Click on an empty path segment → inserts a new waypoint there.
 *   - Click + drag the legend → moves it. Drag a corner handle → resizes.
 *   - Double-click the legend title → inline edit it.
 *   - "Generate with AI" → calls the ldar-observation-path edge function.
 *
 * Layout note: the user might generate a path BEFORE there are any saved
 * edits, so we render whatever's in facility.ldar_observation_path_data on
 * mount. Empty data = blank editor, just the background PDF.
 */

// ============================================================
// Helpers — kept at the top so the component body reads cleanly.
// ============================================================

const VISUAL = {
  // Second pass of size tuning. Israel said circles can be a touch
  // smaller (18 → 16, font 21 → 18) and the walking path stroke is
  // still too thick (6 → 4, dash '10 7' → '8 5' to match). Outline
  // behind the dashed stroke stays at pathStroke + 4 so it remains
  // a visible shadow at any background brightness.
  stopRadius: 16,        // px, in the canonical viewBox
  stopBorder: 3,
  stopFontSize: 18,
  pathStroke: 4,
  pathDash: '8 5',
  pathColor: '#facc15',  // tailwind yellow-400 — matches Israel's screenshot
  pathOutline: '#1f2937',
  stopFill: '#dc2626',   // red-600
  stopBorderColor: '#ffffff',
  stopText: '#ffffff',
  waypointRadius: 8,
  waypointFill: '#facc15',
  waypointBorder: '#1f2937',
  legendBorder: '#dc2626',
  legendBg: 'rgba(255, 255, 255, 0.95)',
  legendNumberFill: '#dc2626',
};

/** Generate a short stable id for new stops/waypoints. */
function shortId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Catmull-Rom → cubic Bezier "M ... C ... C ..." path string.
 *  Tension 0.5 (standard centripetal-ish curve). The path is converted from
 *  normalized 0..1 coords into the canonical viewBox before smoothing. */
function smoothPathD(points: Array<{ x: number; y: number }>, w: number, h: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x * w} ${p.y * h}`;
  }
  const pts = points.map((p) => ({ x: p.x * w, y: p.y * h }));
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

/** Project a pointer event onto the SVG's viewBox coords, then normalize to 0..1. */
function pointerToNormalized(
  e: { clientX: number; clientY: number },
  svg: SVGSVGElement | null,
  imgW: number,
  imgH: number,
): { x: number; y: number } | null {
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: svgPt.x / imgW, y: svgPt.y / imgH };
}

/** Stops sorted by ascending number — used for both path tracing and legend ordering. */
function sortStops(stops: LDARObservationPathStop[]): LDARObservationPathStop[] {
  return [...stops].sort((a, b) => a.number - b.number);
}

/** "Trace" the path through stops in number order, inserting waypoints
 *  into the correct inter-stop segment as identified by their
 *  `afterStop` field. A waypoint with `afterStop = N` belongs on the
 *  segment from stop N to the next-higher-numbered stop.
 *
 *  Legacy data (no afterStop on waypoints) defaults to the first stop's
 *  number — preserves the old "all waypoints between stops 1 and 2"
 *  rendering so saved paths don't suddenly jump around. */
function tracedPointsSimple(
  stops: LDARObservationPathStop[],
  waypoints: LDARObservationPathWaypoint[],
): Array<{ x: number; y: number }> {
  // Off-path stops stay in the legend but are not part of the drawn route.
  const sorted = sortStops(stops.filter((s) => !s.offPath));
  if (sorted.length === 0) return [];
  if (sorted.length === 1) return sorted.map((s) => ({ x: s.x, y: s.y }));

  const legacyAfterStop = sorted[0].number;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const stop = sorted[i];
    out.push({ x: stop.x, y: stop.y });
    if (i < sorted.length - 1) {
      // Waypoints attached to THIS stop's segment, in array order.
      const segWps = waypoints.filter((w) => (w.afterStop ?? legacyAfterStop) === stop.number);
      segWps.forEach((w) => out.push({ x: w.x, y: w.y }));
    }
  }
  return out;
}

/** Distance from a point to a line segment (a,b). All inputs in the same
 *  coordinate space; returned in that same space. Used by the path-click
 *  handler to figure out which segment a new waypoint belongs to. */
function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return Math.sqrt(px * px + py * py);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const ex = p.x - projX;
  const ey = p.y - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Given a click point in normalized 0..1 coords, figure out which
 *  inter-stop segment it's closest to (using the currently rendered
 *  trace points, which include any existing waypoints). Returns the
 *  `afterStop` value that should be assigned to a new waypoint
 *  inserted at this point. */
function inferAfterStop(
  clickN: { x: number; y: number },
  stops: LDARObservationPathStop[],
  waypoints: LDARObservationPathWaypoint[],
): number {
  const sorted = sortStops(stops);
  if (sorted.length === 0) return 1;
  if (sorted.length === 1) return sorted[0].number;
  const legacyAfterStop = sorted[0].number;
  // Build the same trace as tracedPointsSimple, but tagged with the
  // afterStop value each point "belongs to" for click attribution.
  type Tagged = { x: number; y: number; afterStop: number };
  const tagged: Tagged[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const stop = sorted[i];
    // A stop "owns" the segment that STARTS at it — i.e. afterStop = its number.
    // For the last stop, there's no outgoing segment, so we tag it with the
    // previous stop's number (it'll only ever be the END of a segment).
    const afterStopForThis = i < sorted.length - 1 ? stop.number : sorted[i - 1].number;
    tagged.push({ x: stop.x, y: stop.y, afterStop: afterStopForThis });
    if (i < sorted.length - 1) {
      const segWps = waypoints.filter((w) => (w.afterStop ?? legacyAfterStop) === stop.number);
      segWps.forEach((w) => tagged.push({ x: w.x, y: w.y, afterStop: stop.number }));
    }
  }
  let best = Infinity;
  let bestAfterStop = sorted[0].number;
  for (let i = 0; i < tagged.length - 1; i++) {
    const a = tagged[i];
    const b = tagged[i + 1];
    const d = pointToSegmentDistance(clickN, a, b);
    if (d < best) {
      best = d;
      bestAfterStop = a.afterStop;
    }
  }
  return bestAfterStop;
}

/** Format today's date matching the year-digit style of an original
 *  date string from the source PDF. Falls back to MM/D/YY when no
 *  original exists. Used for the date-cell substitution in the title
 *  block. */
function formatDateLikeOriginal(originalDate: string | null): string {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const fullYear = now.getFullYear();
  const twoYear = String(fullYear % 100).padStart(2, '0');
  if (originalDate) {
    // Accept "/" or "-" separators and preserve whichever the template uses
    // (e.g. 6/5/26 → 6/5/26, 3-24-2023 → M-D-YYYY) plus its year-digit style.
    const match = originalDate.match(/(\d{1,2})([/-])(\d{1,2})[/-](\d{2,4})/);
    if (match) {
      const sep = match[2];
      const yearDigits = match[4].length;
      const y = yearDigits === 2 ? twoYear : String(fullYear);
      return `${m}${sep}${d}${sep}${y}`;
    }
  }
  return `${m}/${d}/${twoYear}`;
}

/** Default empty path data. */
function emptyPathData(): LDARObservationPathData {
  return { stops: [], waypoints: [], legend: { x: 0.04, y: 0.82, w: 0.42, h: 0.14, title: 'LDAR OBSERVATION PATH' } };
}

/**
 * Re-extract the Facility Site Plan page from the facility's SPCC PDF
 * and overwrite the source LDAR site-plan file in storage with the
 * fresh page. Returns the rendered image + the new URL/timestamp so
 * the caller can update the editor's pageImage and the facility prop.
 *
 * Pre-two-file-model versions of the editor used to bake annotations
 * into the source on Save (instead of writing to a separate
 * -annotated.pdf path). Facilities that went through that code path
 * have a source PDF with the walking path already baked in — if AI
 * then sees that as input, it produces stacked / duplicated paths.
 * Running this helper before AI generation guarantees a clean canvas
 * regardless of any prior state.
 *
 * No-op (returns null) for facilities without an SPCC plan (user
 * uploaded their own LDAR PDF directly — we trust their upload).
 */
async function refreshSourceFromSPCC(
  facility: Facility,
): Promise<
  | { dataUrl: string; w: number; h: number; newUrl: string; newUploadedAt: string; pageNumber: number }
  | null
> {
  if (!facility.spcc_plan_url) return null;

  const resp = await fetch(facility.spcc_plan_url);
  if (!resp.ok) throw new Error(`Could not fetch SPCC plan (${resp.status})`);
  const buf = await resp.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ ...pdfjsDocumentDefaults, data: buf.slice(0) }).promise;

  // Honor the page the user explicitly chose (LDARSourceSelector) — only
  // fall back to auto-detection when no page has been chosen yet. Previously
  // this re-detected every time, silently overwriting the user's choice with
  // the auto page.
  let pageNumber = facility.ldar_site_plan_source_page ?? null;
  if (pageNumber == null) {
    const detection = await detectSitePlanInLoadedPdf(pdf);
    pageNumber = detection.detectedPage ?? 1;
  }
  // Clamp to the document in case the SPCC plan was re-uploaded shorter.
  pageNumber = Math.max(1, Math.min(pdf.numPages, pageNumber));

  // Extract just that page → upload to the deterministic source path.
  const pdfBlob = await extractPageAsPdf(buf, pageNumber);
  const storagePath = `${facility.id}/site-plan.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('ldar-site-plans')
    .upload(storagePath, pdfBlob, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '60',
    });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from('ldar-site-plans').getPublicUrl(storagePath);
  const newUploadedAt = new Date().toISOString();

  // Patch the facility row so the link cache-buster picks up the new
  // version and future opens fetch the clean source. Also persist the page
  // we used so the choice survives (stabilizes first-time auto-detect too).
  const { error: tsErr } = await supabase
    .from('facilities')
    .update({
      ldar_site_plan_url: publicUrl,
      ldar_site_plan_uploaded_at: newUploadedAt,
      ldar_site_plan_source_page: pageNumber,
    })
    .eq('id', facility.id);
  if (tsErr) throw tsErr;

  // Render the FRESH page to image. Append the timestamp as a query so
  // the browser doesn't serve us the just-overwritten file from cache.
  const cacheBustUrl = `${publicUrl}?t=${encodeURIComponent(newUploadedAt)}`;
  const rendered = await renderPdfPageToImage(cacheBustUrl, { scale: 2 });

  return {
    dataUrl: rendered.dataUrl,
    w: rendered.width,
    h: rendered.height,
    newUrl: publicUrl,
    newUploadedAt,
    pageNumber,
  };
}

/** Make sure every stop and waypoint has a stable id. The AI returns them
 *  without ids (just numbers / coords); older saved data may also lack
 *  them. Without this, useState-based mutations would lose track of which
 *  element is being dragged. */
function sanitizeIds(d: LDARObservationPathData): LDARObservationPathData {
  return {
    ...d,
    stops: (d.stops ?? []).map((s, i) => ({
      ...s,
      id: s.id ?? `s_load_${i}_${Math.random().toString(36).slice(2, 6)}`,
    })),
    waypoints: (d.waypoints ?? []).map((w, i) => ({
      ...w,
      id: w.id ?? `w_load_${i}_${Math.random().toString(36).slice(2, 6)}`,
    })),
  };
}

interface LDARObservationPathEditorProps {
  facility: Facility;
  darkMode: boolean;
  onClose: () => void;
  /** Called after a successful save so the parent can refetch / reflect new state. */
  onSaved: () => void;
  /** When true AND the facility has no existing path data, automatically
   *  fire the AI generation once the PDF page loads. Lets the parent's
   *  "Generate Walking Path with AI" button live up to its promise without
   *  making the user click Generate again inside the editor. Default false. */
  autoGenerate?: boolean;
  /** When provided, shows a "Change page" action that closes the editor and
   *  reopens the source-page picker (for when the wrong SPCC page was picked).
   *  Only meaningful when the source came from a multi-page SPCC plan. */
  onChangePage?: () => void;
}

type DragKind =
  | { kind: 'stop'; id: string }
  | { kind: 'waypoint'; id: string }
  | { kind: 'legend-move' }
  | { kind: 'legend-resize' }
  | { kind: 'titlebox-move' }
  | { kind: 'datebox-move' }
  | { kind: 'customtext-move'; id: string }
  | { kind: 'customtext-resize'; id: string }
  | null;

type SelectionKind =
  | { kind: 'stop'; id: string }
  | { kind: 'waypoint'; id: string }
  | { kind: 'legend' }
  | { kind: 'customText'; id: string }
  | null;

export default function LDARObservationPathEditor({
  facility,
  darkMode,
  onClose,
  onSaved,
  autoGenerate = false,
  onChangePage,
}: LDARObservationPathEditorProps) {
  // The PDF page rendered as a PNG data URL + its native pixel dimensions.
  // We use these dimensions as the SVG viewBox, so 1px in viewBox = 1px in
  // the rendered image (preserveAspectRatio handles container fit).
  const [pageImage, setPageImage] = useState<{ dataUrl: string; w: number; h: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  // Auto-detected bounding boxes (normalized 0..1) of the two title-block
  // text substitutions. Null when the source PDF doesn't have either.
  // Users can ALSO drag the overlays to override the position per-facility
  // — those overrides live in pathData.titleBoxOverride / dateBoxOverride
  // and take precedence over these auto-detected values.
  const [siteplanTitlePos, setSiteplanTitlePos] = useState<TextBoundingBox | null>(null);
  const [datePos, setDatePos] = useState<TextBoundingBox | null>(null);
  /** Original date string from the PDF (e.g. "10/25/21") — used to
   *  determine whether to format today's date with 2- or 4-digit year. */
  const [originalDateStr, setOriginalDateStr] = useState<string | null>(null);

  // The editable path. Sanitized at construction so every stop / waypoint
  // has a stable id (the AI returns them id-less). Subsequent mutations
  // preserve ids — see commitChange / drag handlers.
  const initialData = useMemo<LDARObservationPathData>(
    () => sanitizeIds(facility.ldar_observation_path_data ?? emptyPathData()),
    // Computed once on mount. The editor is keyed by facility.id in its
    // parent so a facility swap unmounts + remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [pathData, setPathData] = useState<LDARObservationPathData>(initialData);
  const stops = pathData.stops;
  const waypoints = pathData.waypoints;

  // ─── Zoom + pan helpers ────────────────────────────────────────────────
  // 0.25 lets the user pull WAY back when the page is taller than the
  // viewport (the SVG is sized with max-h-full so 1x already fits the
  // visible area — going below 1x just gives more breathing room).
  // 6x is plenty for label-level inspection.
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 6;
  const ZOOM_STEP = 1.2;

  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  // The SVG viewBox is fixed at the full page (0 0 W H); zoom physically
  // resizes the page wrapper instead (see pageW/pageH below). So mapping a
  // screen point to page coordinates is a straight rect-relative ratio.
  const clientToPageCoord = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    };
  };

  // Zoom about an anchor (defaults to the viewport centre). Capture the page
  // point under the anchor, change zoom (which resizes the page wrapper), and
  // then — in the layout effect below — nudge the scroll position so that
  // same page point stays under the anchor. Net effect: zoom-to-cursor with
  // the viewing area growing/scrolling as you zoom in.
  const applyZoom = (
    nextRaw: number,
    anchorClientX?: number,
    anchorClientY?: number,
  ) => {
    const next = clampZoom(nextRaw);
    const el = scrollRef.current;
    let ax = anchorClientX;
    let ay = anchorClientY;
    if ((ax == null || ay == null) && el) {
      const r = el.getBoundingClientRect();
      ax = r.left + r.width / 2;
      ay = r.top + r.height / 2;
    }
    const page = ax != null && ay != null ? clientToPageCoord(ax, ay) : null;
    pendingZoomAnchorRef.current =
      page && ax != null && ay != null
        ? { pageX: page.x, pageY: page.y, clientX: ax, clientY: ay }
        : null;
    setZoom(next);
  };

  const zoomIn = () => applyZoom(zoom * ZOOM_STEP);
  const zoomOut = () => applyZoom(zoom / ZOOM_STEP);
  const resetZoom = () => {
    pendingZoomAnchorRef.current = null;
    setZoom(1);
  };

  // Wheel: Ctrl/Cmd (Mac trackpad pinch sends Ctrl+wheel) zooms about the
  // cursor. A plain wheel is left untouched so the scroll container pans
  // natively when the page is zoomed past the viewport.
  const onSvgWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const factor = 1 + Math.min(0.3, Math.abs(e.deltaY) / 200) * dir;
      applyZoom(zoom * factor, e.clientX, e.clientY);
    }
    // else: let the browser scroll the container.
  };

  // Touch: two-finger pinch zoom + two-finger pan. One-finger touches
  // are NOT handled here so the existing pointer-event drag for
  // individual overlay elements (stops, waypoints, legend) keeps working.
  const onSvgTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length !== 2) {
      touchStateRef.current = null;
      return;
    }
    const [t1, t2] = [e.touches[0], e.touches[1]];
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    touchStateRef.current = {
      distance: Math.hypot(dx, dy),
      midX: (t1.clientX + t2.clientX) / 2,
      midY: (t1.clientY + t2.clientY) / 2,
    };
  };
  const onSvgTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length !== 2 || !touchStateRef.current) return;
    e.preventDefault();
    const [t1, t2] = [e.touches[0], e.touches[1]];
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    const newDistance = Math.hypot(dx, dy);
    const newMidX = (t1.clientX + t2.clientX) / 2;
    const newMidY = (t1.clientY + t2.clientY) / 2;
    const prev = touchStateRef.current;

    // Two-finger pan → scroll the container by the midpoint delta.
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft += prev.midX - newMidX;
      el.scrollTop += prev.midY - newMidY;
    }

    // Pinch zoom about the finger midpoint.
    const factor = newDistance / Math.max(1, prev.distance);
    if (Math.abs(factor - 1) > 0.01) {
      applyZoom(zoom * factor, newMidX, newMidY);
    }

    touchStateRef.current = { distance: newDistance, midX: newMidX, midY: newMidY };
  };
  const onSvgTouchEnd = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length < 2) {
      touchStateRef.current = null;
    }
  };

  // Zoom model: the SVG viewBox is fixed at the full page (0 0 W H) and the
  // page wrapper is physically resized by `zoom` inside a scrollable
  // container — so zooming in grows the viewing area and the container
  // scrolls/pans, instead of cropping a fixed-size box. getScreenCTM in
  // pointerToNormalized keeps the drawing coordinates correct at any scale.
  const [zoom, setZoom] = useState(1);
  // Scroll container + its measured inner size, used to size the page so it
  // fits at zoom=1 then scales up from there.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  // Pending zoom anchor: the page point + screen target to re-align scroll to
  // after a zoom changes the wrapper size (applied in the layout effect).
  const pendingZoomAnchorRef = useRef<
    { pageX: number; pageY: number; clientX: number; clientY: number } | null
  >(null);

  // Track the scroll container's size so the fit-to-view math reacts to
  // window/modal resizes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // After a zoom change resizes the page wrapper, nudge the scroll position so
  // the anchored page point stays under the cursor / viewport centre.
  useLayoutEffect(() => {
    const pending = pendingZoomAnchorRef.current;
    const el = scrollRef.current;
    const svg = svgRef.current;
    if (!pending || !el || !svg) return;
    pendingZoomAnchorRef.current = null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const pointScreenX = rect.left + (pending.pageX / W) * rect.width;
    const pointScreenY = rect.top + (pending.pageY / H) * rect.height;
    el.scrollLeft += pointScreenX - pending.clientX;
    el.scrollTop += pointScreenY - pending.clientY;
  }, [zoom]);
  // Multi-touch state for pinch zoom + two-finger pan. Tracks the prior
  // pointer pair so each move applies a delta. one-finger touches fall
  // through to the existing element-drag pointer handlers untouched.
  const touchStateRef = useRef<{
    distance: number;
    midX: number;
    midY: number;
  } | null>(null);

  // View / edit mode + selection.
  const [isEditMode, setIsEditMode] = useState(false);
  const [selection, setSelection] = useState<SelectionKind>(null);
  const [editingNumberOf, setEditingNumberOf] = useState<string | null>(null);
  const [numberInputValue, setNumberInputValue] = useState('');
  // Inline edit of the title-block date cell (double-click the date).
  const [editingDate, setEditingDate] = useState(false);
  const [dateInputValue, setDateInputValue] = useState('');
  // Inline edit of a user-added custom text/date field.
  const [editingCustomTextId, setEditingCustomTextId] = useState<string | null>(null);
  const [customTextInputValue, setCustomTextInputValue] = useState('');
  const [editingLegendTitle, setEditingLegendTitle] = useState(false);
  // Stop id whose label is being edited in-place from inside the legend.
  // Null when nothing is being edited. Driven by double-click on the legend
  // item's text; commits on blur or Enter.
  const [editingLegendItemId, setEditingLegendItemId] = useState<string | null>(null);

  // Drag state. Lives in a ref because the drag handlers fire on every
  // pointer move and we don't want each move to trigger a re-render just
  // to update the "what's being dragged" pointer; the actual position
  // updates flow through setPathData which is already reactive.
  const dragRef = useRef<DragKind>(null);

  // Undo / redo stacks. Each entry is a full snapshot — the JSON is small
  // (a few KB) so this is fine for hours of editing.
  const [undoStack, setUndoStack] = useState<LDARObservationPathData[]>([]);
  const [redoStack, setRedoStack] = useState<LDARObservationPathData[]>([]);

  // AI / save state.
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // -----------------------------------------------------------
  // Load the LDAR site plan PDF and render page 1.
  // -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!facility.ldar_site_plan_url) {
        setLoadError('No LDAR site plan PDF uploaded yet. Upload one first, then try again.');
        setIsLoadingPage(false);
        return;
      }
      setIsLoadingPage(true);
      setLoadError(null);
      try {
        // Cache-bust on the upload timestamp: the source lives at a fixed
        // path ({id}/site-plan.pdf) that gets OVERWRITTEN when the user picks
        // a different page, so without this the browser would serve the stale
        // (old-page) bytes.
        const ts = facility.ldar_site_plan_uploaded_at;
        const srcUrl = ts
          ? `${facility.ldar_site_plan_url}${facility.ldar_site_plan_url!.includes('?') ? '&' : '?'}t=${encodeURIComponent(ts)}`
          : facility.ldar_site_plan_url!;
        const rendered = await renderPdfPageToImage(srcUrl, { scale: 2 });
        if (cancelled) return;
        setPageImage({ dataUrl: rendered.dataUrl, w: rendered.width, h: rendered.height });

        // Also extract title-block text positions from the source PDF so
        // the export can substitute "LDAR OBSERVATION PLAN" in place of
        // "FACILITY SITE PLAN" and overwrite the date cell with today.
        // Best-effort — if anything fails we just skip the overlay.
        try {
          const tsB = facility.ldar_site_plan_uploaded_at;
          const fetchUrl = tsB
            ? `${facility.ldar_site_plan_url}${facility.ldar_site_plan_url!.includes('?') ? '&' : '?'}t=${encodeURIComponent(tsB)}`
            : facility.ldar_site_plan_url!;
          const arrayBuffer = await (await fetch(fetchUrl)).arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ ...pdfjsDocumentDefaults, data: arrayBuffer }).promise;
          const page = await pdf.getPage(1);
          const [titlePos, foundDate] = await Promise.all([
            findTextInPdfPage(page, 'FACILITY SITE PLAN'),
            findDateInPdfPage(page),
          ]);
          if (cancelled) return;
          setSiteplanTitlePos(titlePos);
          setDatePos(foundDate);
          setOriginalDateStr(foundDate ? foundDate.matchedText.trim() : null);
        } catch (err) {
          // Non-fatal: title-block substitution is a nice-to-have.
          console.warn('LDAR editor: title-block text lookup failed', err);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('LDAR editor: failed to render PDF page', err);
        setLoadError(err instanceof Error ? err.message : 'Failed to render the LDAR site plan PDF.');
      } finally {
        if (!cancelled) setIsLoadingPage(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facility.ldar_site_plan_url, facility.ldar_site_plan_uploaded_at]);

  // -----------------------------------------------------------
  // State mutation helpers (with undo support).
  // -----------------------------------------------------------
  const commitChange = useCallback(
    (next: LDARObservationPathData) => {
      setUndoStack((prev) => [...prev, pathData]);
      setRedoStack([]);
      setPathData(next);
      setHasUnsavedChanges(true);
    },
    [pathData],
  );

  /** Push a snapshot onto undo (call at the START of a drag). */
  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [...prev, pathData]);
    setRedoStack([]);
  }, [pathData]);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, pathData]);
      setPathData(last);
      setHasUnsavedChanges(true);
      return prev.slice(0, -1);
    });
  }, [pathData]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setUndoStack((u) => [...u, pathData]);
      setPathData(last);
      setHasUnsavedChanges(true);
      return prev.slice(0, -1);
    });
  }, [pathData]);

  // -----------------------------------------------------------
  // AI generation.
  // -----------------------------------------------------------
  const handleGenerate = useCallback(async () => {
    if (!pageImage) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      // ---- Step A: refresh the source PDF from the SPCC plan, if
      // available. Two reasons this matters:
      //   1. Defensive: pre–two-file-model versions of this editor used
      //      to bake annotations into the source on Save, leaving a
      //      doubly-annotated PDF behind. If we just send that to AI,
      //      it produces a stacked walking path on top of the old one.
      //   2. Future-proof: ensures every Generate starts from a known-
      //      clean canvas regardless of any prior tinkering.
      // For facilities WITHOUT an SPCC plan (user uploaded their own
      // LDAR PDF), we trust the existing source and skip this step.
      let workingImage = pageImage;
      if (facility.spcc_plan_url) {
        try {
          const fresh = await refreshSourceFromSPCC(facility);
          if (fresh) {
            workingImage = { dataUrl: fresh.dataUrl, w: fresh.w, h: fresh.h };
            setPageImage(workingImage);
            // Mutate the prop so subsequent reads (handleSave, link in
            // LDARSitePlanSection) see the refreshed URL + cache-buster.
            Object.assign(facility, {
              ldar_site_plan_url: fresh.newUrl,
              ldar_site_plan_uploaded_at: fresh.newUploadedAt,
              ldar_site_plan_source_page: fresh.pageNumber,
            });
          }
        } catch (refreshErr) {
          // Non-fatal: log + continue with existing source. The user
          // may end up with stacked annotations but at least Generate
          // doesn't fail outright.
          console.warn(
            'Source refresh from SPCC failed; using existing source PDF:',
            refreshErr,
          );
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not signed in.');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const resp = await fetch(`${supabaseUrl}/functions/v1/ldar-observation-path`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          facilityId: facility.id,
          imageBase64: workingImage.dataUrl,
          imageMimeType: 'image/png',
        }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(json?.error || `Generation failed (${resp.status})`);
      }
      // Server returns { stops, waypoints, legend, model, generated_at }.
      // Attach ids to stops/waypoints so they're stable across edits.
      const aiData: LDARObservationPathData = {
        stops: (json.stops as Array<Omit<LDARObservationPathStop, 'id'>>).map((s, i) => ({
          ...s,
          id: shortId(`s${i}`),
        })),
        waypoints: (json.waypoints as Array<Omit<LDARObservationPathWaypoint, 'id'>>).map((w, i) => ({
          ...w,
          id: shortId(`w${i}`),
        })),
        legend: json.legend,
        imageSize: { w: workingImage.w, h: workingImage.h },
        model: json.model,
        generated_at: json.generated_at,
      };
      commitChange(aiData);
      setIsEditMode(true);
    } catch (err) {
      console.error('AI generation failed', err);
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate observation path.');
    } finally {
      setIsGenerating(false);
    }
  }, [pageImage, facility.id, commitChange]);

  // -----------------------------------------------------------
  // Auto-fire generation once when the parent passed autoGenerate=true and
  // there's nothing drawn yet. The ref guards against re-firing on
  // re-renders (each commitChange would otherwise trigger this effect via
  // its handleGenerate dependency).
  // -----------------------------------------------------------
  const autoGenFiredRef = useRef(false);
  useEffect(() => {
    if (!autoGenerate) return;
    if (autoGenFiredRef.current) return;
    if (!pageImage) return;
    if (stops.length > 0) return; // Don't overwrite an existing path silently.
    if (isGenerating) return;
    autoGenFiredRef.current = true;
    handleGenerate();
  }, [autoGenerate, pageImage, stops.length, isGenerating, handleGenerate]);

  // -----------------------------------------------------------
  // Save to DB + bake annotated PDF and overwrite the site-plan file.
  // -----------------------------------------------------------
  const [saveStage, setSaveStage] = useState<'idle' | 'json' | 'pdf'>('idle');
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveStage('json');
    // Tracks whether the (non-fatal) annotated-PDF step failed — if so we
    // keep the editor open so the error banner stays visible to re-save.
    let pdfSoftFailed = false;
    try {
      // 1. JSON — fast write, this is the source of truth for the editor.
      const toSave: LDARObservationPathData = {
        ...pathData,
        edited_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('facilities')
        .update({ ldar_observation_path_data: toSave })
        .eq('id', facility.id);
      if (error) throw error;
      Object.assign(facility, { ldar_observation_path_data: toSave });

      // 2. PDF — render the editor SVG (background + walking-path
      //    overlay + title-block text substitutions) to a flat
      //    single-page PDF and upload to a SEPARATE storage path
      //    ({facility_id}/site-plan-annotated.pdf) so the source PDF
      //    at {facility_id}/site-plan.pdf stays untouched. The editor
      //    keeps loading the source PDF on re-open — so re-editing
      //    later doesn't bake annotations into already-annotated text.
      //    The annotated URL is stored on observation_path_data so the
      //    LDAR Site Plan section can link the user to the rendered
      //    version. Wrapped in its own try so a PDF failure doesn't
      //    undo a successful JSON save.
      if (svgRef.current && pageImage) {
        setSaveStage('pdf');
        try {
          // Bake a CLEAN render: force view mode + clear any selection/inline
          // edits so none of the edit-only chrome (dashed boxes, the legend
          // resize handle, selection halos, off-path ghosts, inline inputs)
          // ends up baked into the exported PDF. flushSync forces the DOM to
          // update before we capture; we restore the editor state afterward.
          const restoreEdit = isEditMode;
          const restoreSel = selection;
          flushSync(() => {
            setIsEditMode(false);
            setSelection(null);
            setEditingNumberOf(null);
            setEditingDate(false);
            setEditingCustomTextId(null);
            setEditingLegendTitle(false);
            setEditingLegendItemId(null);
          });
          let pdfBlob: Blob;
          try {
            pdfBlob = await svgToPdfBlob(svgRef.current, pageImage.w, pageImage.h);
          } finally {
            flushSync(() => {
              setIsEditMode(restoreEdit);
              setSelection(restoreSel);
            });
          }
          const nowIso = new Date().toISOString();
          // Store the baked PDF under the CANONICAL filename so the browser
          // preview tab (and any download from it) carry the right name,
          // matching the Download button:
          //   "Name - Camino ID - LDAR Site Path (date).pdf"
          // The filename's date comes from the plan (dateValueOverride or this
          // bake's timestamp), so build it off the data we're about to save.
          const dataForName: LDARObservationPathData = { ...toSave, annotated_pdf_uploaded_at: nowIso };
          const annotatedPath = `${facility.id}/${buildLdarSitePlanFilename({
            ...facility,
            ldar_observation_path_data: dataForName,
          })}`;

          // Clean up the previous annotated object when it lived at a different
          // path (the old fixed name, or a prior date) so storage doesn't
          // accrete stale files. Best-effort — never blocks the save.
          const prevUrl = facility.ldar_observation_path_data?.annotated_pdf_url;
          if (prevUrl) {
            try {
              const prevPath = decodeURIComponent(
                prevUrl.replace(/^.*\/ldar-site-plans\//, '').split('?')[0],
              );
              if (prevPath && prevPath !== annotatedPath) {
                await supabase.storage.from('ldar-site-plans').remove([prevPath]);
              }
            } catch {
              /* non-fatal */
            }
          }

          const { error: uploadError } = await supabase.storage
            .from('ldar-site-plans')
            .upload(annotatedPath, pdfBlob, {
              contentType: 'application/pdf',
              upsert: true,
              cacheControl: '60',
            });
          if (uploadError) throw uploadError;
          const {
            data: { publicUrl: annotatedUrl },
          } = supabase.storage.from('ldar-site-plans').getPublicUrl(annotatedPath);

          // Record the annotated URL + upload time on the path data so
          // the section can link to it and cache-bust per save. Source
          // PDF (ldar_site_plan_url + ldar_site_plan_uploaded_at) is
          // intentionally NOT touched.
          const withAnnotated: LDARObservationPathData = {
            ...toSave,
            annotated_pdf_url: annotatedUrl,
            annotated_pdf_uploaded_at: nowIso,
          };
          const { error: tsErr } = await supabase
            .from('facilities')
            .update({ ldar_observation_path_data: withAnnotated })
            .eq('id', facility.id);
          if (tsErr) throw tsErr;
          Object.assign(facility, { ldar_observation_path_data: withAnnotated });
        } catch (pdfErr) {
          pdfSoftFailed = true;
          console.warn('Annotated PDF generation failed (JSON was saved):', pdfErr);
          setSaveError(
            (pdfErr instanceof Error ? pdfErr.message : 'Annotated PDF generation failed') +
              ' — your path JSON was saved successfully; you can re-save to retry the PDF.',
          );
        }
      }

      setHasUnsavedChanges(false);
      onSaved();
      // On a clean save, close the editor and drop the user back onto the
      // LDAR tab (already open underneath). Keep it open if the annotated
      // PDF soft-failed so the banner is visible and they can re-save.
      if (!pdfSoftFailed) onClose();
    } catch (err) {
      console.error('Save failed', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setIsSaving(false);
      setSaveStage('idle');
    }
  }, [pathData, facility, onSaved, onClose, pageImage, isEditMode, selection]);

  // Close the editor, confirming first if there are unsaved edits so the user
  // can't lose work by mis-clicking the X or hitting Escape.
  const attemptClose = useCallback(() => {
    if (hasUnsavedChanges) {
      const ok = window.confirm(
        'You have unsaved changes to the observation path. Discard them and close the editor?',
      );
      if (!ok) return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  // Reopen the source-page picker (when the wrong SPCC page was chosen). The
  // current path is for the old page, so this discards it and regenerates on
  // the page the user picks next — confirm before throwing work away.
  const handleChangePage = useCallback(() => {
    if (!onChangePage) return;
    const ok = window.confirm(
      hasUnsavedChanges || stops.length > 0
        ? 'Pick a different source page? The current walking path will be discarded and regenerated on the page you choose.'
        : 'Pick a different source page for this plan?',
    );
    if (!ok) return;
    onChangePage();
  }, [onChangePage, hasUnsavedChanges, stops.length]);

  // Escape closes ONLY this editor, never the facility modal beneath it. We
  // listen in the capture phase on window and stopImmediatePropagation so the
  // modal's own document-level Escape handler never sees the event. If an
  // inline field (label / number) is focused, Escape just blurs it (which
  // commits the edit) instead of closing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
        target?.blur();
        return;
      }
      attemptClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [attemptClose]);

  // -----------------------------------------------------------
  // Pointer handlers — drag for stops, waypoints, legend move/resize.
  // -----------------------------------------------------------
  const onSvgPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || !pageImage) return;
      const norm = pointerToNormalized(e, svgRef.current, pageImage.w, pageImage.h);
      if (!norm) return;
      const cx = Math.max(0, Math.min(1, norm.x));
      const cy = Math.max(0, Math.min(1, norm.y));
      if (drag.kind === 'stop') {
        setPathData((prev) => ({
          ...prev,
          stops: prev.stops.map((s) => (s.id === drag.id ? { ...s, x: cx, y: cy } : s)),
        }));
        setHasUnsavedChanges(true);
      } else if (drag.kind === 'waypoint') {
        setPathData((prev) => ({
          ...prev,
          waypoints: prev.waypoints.map((w) => (w.id === drag.id ? { ...w, x: cx, y: cy } : w)),
        }));
        setHasUnsavedChanges(true);
      } else if (drag.kind === 'legend-move') {
        setPathData((prev) => ({
          ...prev,
          legend: {
            ...prev.legend,
            x: Math.max(0, Math.min(1 - prev.legend.w, cx - prev.legend.w / 2)),
            y: Math.max(0, Math.min(1 - prev.legend.h, cy - prev.legend.h / 2)),
          },
        }));
        setHasUnsavedChanges(true);
      } else if (drag.kind === 'legend-resize') {
        setPathData((prev) => ({
          ...prev,
          legend: {
            ...prev.legend,
            w: Math.max(0.1, Math.min(1 - prev.legend.x, cx - prev.legend.x)),
            h: Math.max(0.04, Math.min(1 - prev.legend.y, cy - prev.legend.y)),
          },
        }));
        setHasUnsavedChanges(true);
      } else if (drag.kind === 'titlebox-move') {
        // Center the override box on the cursor. The starting w/h come from
        // whichever source is current (existing override or the auto-
        // detected position from the PDF).
        setPathData((prev) => {
          const fallback = siteplanTitlePos;
          const current = prev.titleBoxOverride ?? (fallback
            ? { x: fallback.x, y: fallback.y, w: fallback.w, h: fallback.h }
            : null);
          if (!current) return prev;
          return {
            ...prev,
            titleBoxOverride: {
              w: current.w,
              h: current.h,
              x: Math.max(0, Math.min(1 - current.w, cx - current.w / 2)),
              y: Math.max(0, Math.min(1 - current.h, cy - current.h / 2)),
            },
          };
        });
        setHasUnsavedChanges(true);
      } else if (drag.kind === 'datebox-move') {
        setPathData((prev) => {
          const fallback = datePos;
          const current = prev.dateBoxOverride ?? (fallback
            ? { x: fallback.x, y: fallback.y, w: fallback.w, h: fallback.h }
            : null);
          if (!current) return prev;
          return {
            ...prev,
            dateBoxOverride: {
              w: current.w,
              h: current.h,
              x: Math.max(0, Math.min(1 - current.w, cx - current.w / 2)),
              y: Math.max(0, Math.min(1 - current.h, cy - current.h / 2)),
            },
          };
        });
        setHasUnsavedChanges(true);
      } else if (drag.kind === 'customtext-move') {
        setPathData((prev) => ({
          ...prev,
          customTextBoxes: (prev.customTextBoxes ?? []).map((b) =>
            b.id === drag.id
              ? {
                  ...b,
                  x: Math.max(0, Math.min(1 - b.w, cx - b.w / 2)),
                  y: Math.max(0, Math.min(1 - b.h, cy - b.h / 2)),
                }
              : b,
          ),
        }));
        setHasUnsavedChanges(true);
      } else if (drag.kind === 'customtext-resize') {
        // Drag the bottom-right corner — width/height follow the cursor.
        // Height drives the font size, so this is how the user shrinks it.
        setPathData((prev) => ({
          ...prev,
          customTextBoxes: (prev.customTextBoxes ?? []).map((b) =>
            b.id === drag.id
              ? {
                  ...b,
                  w: Math.max(0.015, Math.min(1 - b.x, cx - b.x)),
                  h: Math.max(0.008, Math.min(1 - b.y, cy - b.y)),
                }
              : b,
          ),
        }));
        setHasUnsavedChanges(true);
      }
    },
    [pageImage, siteplanTitlePos, datePos],
  );

  const onSvgPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const startStopDrag = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!isEditMode) return;
      e.stopPropagation();
      pushUndo();
      dragRef.current = { kind: 'stop', id };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setSelection({ kind: 'stop', id });
    },
    [isEditMode, pushUndo],
  );

  const startWaypointDrag = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!isEditMode) return;
      e.stopPropagation();
      pushUndo();
      dragRef.current = { kind: 'waypoint', id };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setSelection({ kind: 'waypoint', id });
    },
    [isEditMode, pushUndo],
  );

  const startLegendMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isEditMode) return;
      e.stopPropagation();
      pushUndo();
      dragRef.current = { kind: 'legend-move' };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setSelection({ kind: 'legend' });
    },
    [isEditMode, pushUndo],
  );

  const startLegendResize = useCallback(
    (e: React.PointerEvent) => {
      if (!isEditMode) return;
      e.stopPropagation();
      pushUndo();
      dragRef.current = { kind: 'legend-resize' };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setSelection({ kind: 'legend' });
    },
    [isEditMode, pushUndo],
  );

  const startTitleboxDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!isEditMode) return;
      e.stopPropagation();
      pushUndo();
      dragRef.current = { kind: 'titlebox-move' };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    [isEditMode, pushUndo],
  );

  const startDateboxDrag = useCallback(
    (e: React.PointerEvent) => {
      if (!isEditMode) return;
      e.stopPropagation();
      pushUndo();
      dragRef.current = { kind: 'datebox-move' };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    [isEditMode, pushUndo],
  );

  const startCustomTextDrag = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!isEditMode) return;
      e.stopPropagation();
      pushUndo();
      dragRef.current = { kind: 'customtext-move', id };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setSelection({ kind: 'customText', id });
    },
    [isEditMode, pushUndo],
  );

  const startCustomTextResize = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (!isEditMode) return;
      e.stopPropagation();
      pushUndo();
      dragRef.current = { kind: 'customtext-resize', id };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      setSelection({ kind: 'customText', id });
    },
    [isEditMode, pushUndo],
  );

  // -----------------------------------------------------------
  // Click-on-path-segment → insert waypoint at that location.
  // -----------------------------------------------------------
  const handlePathClick = useCallback(
    (e: React.MouseEvent<SVGPathElement>) => {
      if (!isEditMode || !pageImage) return;
      const norm = pointerToNormalized(e, svgRef.current, pageImage.w, pageImage.h);
      if (!norm) return;
      // Figure out which inter-stop segment the click is on, so the new
      // waypoint ends up shaping the right part of the route instead of
      // getting dumped into the default (between stops 1 and 2).
      const afterStop = inferAfterStop(norm, pathData.stops, pathData.waypoints);
      const newWp: LDARObservationPathWaypoint = {
        id: shortId('w'),
        x: norm.x,
        y: norm.y,
        afterStop,
      };
      commitChange({
        ...pathData,
        waypoints: [...pathData.waypoints, newWp],
      });
      setSelection({ kind: 'waypoint', id: newWp.id });
    },
    [isEditMode, pageImage, pathData, commitChange],
  );

  // -----------------------------------------------------------
  // Number-edit (double-click on stop → small inline input).
  // -----------------------------------------------------------
  const beginEditNumber = useCallback((stop: LDARObservationPathStop) => {
    if (!isEditMode) return;
    setEditingNumberOf(stop.id);
    setNumberInputValue(String(stop.number));
  }, [isEditMode]);

  const commitNumberEdit = useCallback(() => {
    if (!editingNumberOf) return;
    const parsed = parseInt(numberInputValue, 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 1000) {
      commitChange({
        ...pathData,
        stops: pathData.stops.map((s) => (s.id === editingNumberOf ? { ...s, number: parsed } : s)),
      });
    }
    setEditingNumberOf(null);
  }, [editingNumberOf, numberInputValue, pathData, commitChange]);

  // -----------------------------------------------------------
  // Inline edit of the title-block date cell.
  // -----------------------------------------------------------
  const beginEditDate = useCallback((currentText: string) => {
    if (!isEditMode) return;
    setDateInputValue(currentText);
    setEditingDate(true);
  }, [isEditMode]);

  const commitDateEdit = useCallback(() => {
    if (!editingDate) return;
    const v = dateInputValue.trim();
    // Empty → clear the override and fall back to the auto "today" value.
    commitChange({ ...pathData, dateValueOverride: v || null });
    setEditingDate(false);
  }, [editingDate, dateInputValue, pathData, commitChange]);

  // -----------------------------------------------------------
  // Custom user-added text/date fields ("Add Date").
  // -----------------------------------------------------------
  const addCustomTextBox = useCallback(() => {
    // Default the value to the current document date so it's a usable date
    // field out of the box; the user can double-click to change it.
    const defaultText =
      pathData.dateValueOverride ?? formatDateLikeOriginal(originalDateStr);
    const id = shortId('t');
    const box: LDARCustomTextBox = {
      id,
      x: 0.46,
      y: 0.5,
      // Small by default (roughly title-block text size); the resize handle
      // lets the user grow/shrink it from here.
      w: 0.07,
      h: 0.014,
      text: defaultText,
    };
    commitChange({
      ...pathData,
      customTextBoxes: [...(pathData.customTextBoxes ?? []), box],
    });
    setSelection({ kind: 'customText', id });
  }, [pathData, originalDateStr, commitChange]);

  const beginEditCustomText = useCallback((id: string, currentText: string) => {
    if (!isEditMode) return;
    setCustomTextInputValue(currentText);
    setEditingCustomTextId(id);
  }, [isEditMode]);

  const commitCustomTextEdit = useCallback(() => {
    if (!editingCustomTextId) return;
    const v = customTextInputValue.trim();
    commitChange({
      ...pathData,
      customTextBoxes: (pathData.customTextBoxes ?? []).map((b) =>
        b.id === editingCustomTextId ? { ...b, text: v } : b,
      ),
    });
    setEditingCustomTextId(null);
  }, [editingCustomTextId, customTextInputValue, pathData, commitChange]);

  // -----------------------------------------------------------
  // Add a new stop ("Area").
  //   - If a stop is currently selected → INSERT after it: shift every
  //     stop whose number > selected.number up by 1, then give the new
  //     stop number = selected.number + 1. The legend reorders by
  //     number, so this slots the new stop into the correct sequence
  //     position automatically.
  //   - Otherwise → append at the end with the next-highest number.
  // The new stop is also auto-selected so the user can reposition it
  // immediately. Position defaults to a small offset from the source
  // stop so it doesn't sit exactly on top.
  // -----------------------------------------------------------
  const addStop = useCallback(() => {
    const selectedStop = selection?.kind === 'stop'
      ? pathData.stops.find((s) => s.id === selection.id) ?? null
      : null;

    const newId = shortId('s');

    if (selectedStop) {
      const insertAfter = selectedStop.number;
      const newNumber = insertAfter + 1;
      // Place slightly down-right of the source stop so they don't
      // overlap; clamp so the new one stays on-canvas.
      const nx = Math.max(0.02, Math.min(0.98, selectedStop.x + 0.03));
      const ny = Math.max(0.02, Math.min(0.98, selectedStop.y + 0.03));
      const shifted = pathData.stops.map((s) =>
        s.number > insertAfter ? { ...s, number: s.number + 1 } : s,
      );
      commitChange({
        ...pathData,
        stops: [
          ...shifted,
          { id: newId, number: newNumber, x: nx, y: ny, label: `Area ${newNumber}` },
        ],
      });
    } else {
      const nextNumber = pathData.stops.length === 0
        ? 1
        : Math.max(...pathData.stops.map((s) => s.number)) + 1;
      commitChange({
        ...pathData,
        stops: [
          ...pathData.stops,
          { id: newId, number: nextNumber, x: 0.5, y: 0.5, label: `Area ${nextNumber}` },
        ],
      });
    }

    // Select the new one so the user can drag it / edit its label right
    // away.
    setSelection({ kind: 'stop', id: newId });
  }, [pathData, commitChange, selection]);

  // -----------------------------------------------------------
  // Delete the currently selected element.
  // -----------------------------------------------------------
  const deleteSelected = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'stop') {
      commitChange({
        ...pathData,
        stops: pathData.stops.filter((s) => s.id !== selection.id),
      });
    } else if (selection.kind === 'waypoint') {
      commitChange({
        ...pathData,
        waypoints: pathData.waypoints.filter((w) => w.id !== selection.id),
      });
    } else if (selection.kind === 'customText') {
      commitChange({
        ...pathData,
        customTextBoxes: (pathData.customTextBoxes ?? []).filter((b) => b.id !== selection.id),
      });
    }
    setSelection(null);
  }, [selection, pathData, commitChange]);

  // -----------------------------------------------------------
  // Update the selected stop's label (legend text).
  // -----------------------------------------------------------
  const updateSelectedStopLabel = useCallback((label: string) => {
    if (!selection || selection.kind !== 'stop') return;
    setPathData((prev) => ({
      ...prev,
      stops: prev.stops.map((s) => (s.id === selection.id ? { ...s, label } : s)),
    }));
    setHasUnsavedChanges(true);
  }, [selection]);

  // -----------------------------------------------------------
  // Toggle the selected stop on/off the drawn path. Off-path stops stay in
  // the legend (so the user can keep listing them, then delete them from the
  // legend separately) but drop out of the route + exported map.
  // -----------------------------------------------------------
  const setSelectedStopOffPath = useCallback((off: boolean) => {
    if (!selection || selection.kind !== 'stop') return;
    commitChange({
      ...pathData,
      stops: pathData.stops.map((s) =>
        s.id === selection.id ? { ...s, offPath: off } : s,
      ),
    });
  }, [selection, pathData, commitChange]);

  // -----------------------------------------------------------
  // Reset to AI-generated state (or empty if never generated).
  // -----------------------------------------------------------
  const resetToInitial = useCallback(() => {
    if (!confirm('Discard all edits and reset to the originally saved path?')) return;
    commitChange(initialData);
    setSelection(null);
  }, [initialData, commitChange]);

  // ----------------------------------------------------------
  // Sorted legend items, derived from stops sorted by number.
  // ----------------------------------------------------------
  const legendItems = useMemo(() => sortStops(stops), [stops]);

  // The path goes first-stop → waypoints → remaining stops in number order.
  const pathPoints = useMemo(
    () => tracedPointsSimple(stops, waypoints),
    [stops, waypoints],
  );

  const selectedStop = selection?.kind === 'stop'
    ? stops.find((s) => s.id === selection.id)
    : null;

  // =========================================================
  // RENDER
  // =========================================================
  const W = pageImage?.w ?? 1700;
  const H = pageImage?.h ?? 1200;

  // Largest page size that fits the measured viewport at zoom=1 (with a small
  // margin), then scaled by `zoom`. When zoom>1 the page exceeds the scroll
  // container, so it scrolls — the viewing area grows with the zoom.
  const PAGE_PAD = 24; // matches the p-3 around the canvas
  const fitScale = (() => {
    const availW = viewport.w - PAGE_PAD;
    const availH = viewport.h - PAGE_PAD;
    if (availW <= 0 || availH <= 0) return 0;
    return Math.min(availW / W, availH / H);
  })();
  const pageW = fitScale > 0 ? W * fitScale * zoom : 0;
  const pageH = fitScale > 0 ? H * fitScale * zoom : 0;

  // Render via createPortal at the document.body level so the editor sits
  // above any parent modal (FacilityDetailModal renders at zIndex 999999;
  // we use 1000001 to outrank it). Without the portal, this would be
  // trapped inside the parent's stacking context.
  return createPortal(
    <div className="fixed inset-0 flex flex-col bg-black/80 backdrop-blur-sm" style={{ zIndex: 1000001 }}>
      {/* Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b ${
          darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={attemptClose}
            className={`p-2 rounded-lg ${
              darkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
            }`}
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className={`text-sm font-semibold truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              LDAR Observation Path
            </h2>
            <p className={`text-xs truncate ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {facility.name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Zoom controls — buttons + visible % stay synced with the
              wheel/pinch handlers on the SVG. Hidden while the page
              hasn't loaded yet to avoid a flash of useless controls. */}
          {pageImage && (
            <div
              className={`inline-flex items-center rounded-lg border ${
                darkMode
                  ? 'border-gray-700 bg-gray-800/40 text-gray-200'
                  : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}
            >
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoom <= ZOOM_MIN + 0.001}
                title="Zoom out (Ctrl/⌘ + scroll, or pinch)"
                className="p-1.5 rounded-l-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={resetZoom}
                title="Reset zoom"
                className={`px-2 text-xs font-medium tabular-nums border-x ${
                  darkMode ? 'border-gray-700' : 'border-gray-200'
                } hover:bg-black/5 dark:hover:bg-white/10`}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={zoomIn}
                disabled={zoom >= ZOOM_MAX - 0.001}
                title="Zoom in (Ctrl/⌘ + scroll, or pinch)"
                className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={resetZoom}
                title="Fit to view (reset zoom to 100%)"
                className="p-1.5 rounded-r-lg hover:bg-black/5 dark:hover:bg-white/10"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!pageImage || isGenerating}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              !pageImage || isGenerating
                ? 'bg-purple-500/40 text-white cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white'
            }`}
            title="Have AI generate or regenerate the observation path"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isGenerating ? 'Generating…' : stops.length === 0 ? 'Generate with AI' : 'Regenerate with AI'}
          </button>

          {/* Change source page — only when the source came from a multi-page
              SPCC plan and the parent wired up the picker. */}
          {onChangePage && facility.spcc_plan_url && (
            <button
              type="button"
              onClick={handleChangePage}
              disabled={isGenerating}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                darkMode
                  ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700'
                  : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-300'
              }`}
              title="Pick a different page from the SPCC plan to draw on"
            >
              <Files className="w-4 h-4" />
              Change page
            </button>
          )}

          <div className={`h-6 w-px ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />

          <button
            type="button"
            onClick={() => {
              setIsEditMode((v) => !v);
              setSelection(null);
            }}
            disabled={!pageImage}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isEditMode
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : darkMode
                  ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700'
                  : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-300'
            } disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {isEditMode ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            {isEditMode ? 'View' : 'Edit'}
          </button>

          {isEditMode && (
            <>
              <button
                type="button"
                onClick={addStop}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                  darkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-300'
                }`}
                title={
                  selection?.kind === 'stop'
                    ? 'Insert a new Area after the selected one; following Area numbers shift up'
                    : 'Add a new Area at the end'
                }
              >
                <Plus className="w-3.5 h-3.5" />
                Area
              </button>

              <button
                type="button"
                onClick={addCustomTextBox}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                  darkMode ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-300'
                }`}
                title="Add a date/text field — drag to place it, double-click to edit"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                Date
              </button>

              <button
                type="button"
                onClick={deleteSelected}
                disabled={!selection || selection.kind === 'legend'}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                  darkMode
                    ? 'bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-900/60'
                    : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={
                  selection?.kind === 'stop'
                    ? 'Delete this stop entirely — removes it from the path AND the legend'
                    : selection?.kind === 'customText'
                      ? 'Delete the selected date/text field'
                      : selection
                        ? 'Delete the selected stop/waypoint'
                        : 'Select a stop, waypoint, or date field to delete'
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>

              <div className={`h-6 w-px ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />

              <button
                type="button"
                onClick={undo}
                disabled={undoStack.length === 0}
                className={`p-1.5 rounded-lg ${
                  darkMode ? 'hover:bg-gray-800 text-gray-300 disabled:text-gray-600' : 'hover:bg-gray-100 text-gray-700 disabled:text-gray-300'
                } disabled:cursor-not-allowed`}
                title="Undo"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={redoStack.length === 0}
                className={`p-1.5 rounded-lg ${
                  darkMode ? 'hover:bg-gray-800 text-gray-300 disabled:text-gray-600' : 'hover:bg-gray-100 text-gray-700 disabled:text-gray-300'
                } disabled:cursor-not-allowed`}
                title="Redo"
              >
                <Redo2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={resetToInitial}
                className={`p-1.5 rounded-lg ${
                  darkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-700'
                }`}
                title="Reset to the originally saved path"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </>
          )}

          <div className={`h-6 w-px ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isSaving
                ? 'bg-emerald-500/40 text-white cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
            title={
              hasUnsavedChanges
                ? 'Save changes + bake the annotated PDF'
                : 'Re-save to re-bake the annotated PDF (no changes needed)'
            }
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saveStage === 'pdf' ? 'Baking PDF…' : saveStage === 'json' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Selected stop label editor (toolbar row 2) — only when in edit mode and a stop is selected */}
      {isEditMode && selectedStop && (
        <div
          className={`flex items-center gap-2 px-4 py-2 border-b ${
            darkMode ? 'bg-gray-900/80 border-gray-800' : 'bg-gray-50 border-gray-200'
          }`}
        >
          <span className={`text-xs font-medium flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold">
              {selectedStop.number}
            </span>
            Stop label
          </span>
          <input
            type="text"
            value={selectedStop.label}
            onChange={(e) => updateSelectedStopLabel(e.target.value)}
            className={`flex-1 px-2 py-1 text-sm rounded border ${
              darkMode
                ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
            }`}
            placeholder="e.g. Wellheads (2x)"
          />
          {/* Remove this point from the route while keeping its legend entry
              (or restore it). Full deletion is the Delete button above, which
              also removes it from the legend. */}
          <button
            type="button"
            onClick={() => setSelectedStopOffPath(!selectedStop.offPath)}
            title={
              selectedStop.offPath
                ? 'Put this point back on the path'
                : 'Remove this point from the path — it stays in the legend until you delete it'
            }
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              selectedStop.offPath
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : darkMode
                  ? 'bg-amber-900/40 text-amber-300 hover:bg-amber-900/60'
                  : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
            }`}
          >
            {selectedStop.offPath ? (
              <>
                <Route className="w-3.5 h-3.5" />
                Add to path
              </>
            ) : (
              <>
                <Scissors className="w-3.5 h-3.5" />
                Remove from path
              </>
            )}
          </button>
          <span className={`hidden lg:inline text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {selectedStop.offPath
              ? 'In legend only — use Delete to remove it from the legend'
              : 'Double-click the circle to edit its number'}
          </span>
        </div>
      )}

      {/* Error banners */}
      {(generateError || saveError || loadError) && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-900/60 flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 truncate">{loadError || generateError || saveError}</span>
        </div>
      )}

      {/* Canvas area. Grid + place-items-center gives both a defined
          container area for the page wrapper AND centers it. Switched
          from a flex container with items-start so the wrapper's
          aspect-ratio + max-h-full can actually resolve against a
          defined parent height. */}
      {/* Scrollable canvas. The page wrapper is centred via m-auto when it
          fits and pins to the top-left (scrollable) once zoom makes it larger
          than this container — so the viewing area genuinely grows with zoom. */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-3 flex">
        {isLoadingPage ? (
          <div className="m-auto flex flex-col items-center gap-3 text-white py-20">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Loading LDAR site plan…</p>
          </div>
        ) : !pageImage ? (
          <div className="m-auto text-white py-20 text-center max-w-md">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-yellow-400" />
            <p className="text-sm">
              {loadError || 'Upload an LDAR site plan PDF to start drawing a walking path.'}
            </p>
          </div>
        ) : (
          <div
            className={`relative shadow-2xl m-auto flex-shrink-0 ${
              darkMode ? 'bg-gray-950' : 'bg-white'
            } ${isEditMode ? 'cursor-crosshair' : 'cursor-default'}`}
            // Physical pixel size = "fit at zoom 1" × zoom. The fixed viewBox
            // (0 0 W H) means the SVG content always scales to fill this box.
            style={{
              width: pageW || undefined,
              height: pageH || undefined,
            }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="xMidYMid meet"
              className="block w-full h-full select-none touch-none"
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerCancel={onSvgPointerUp}
              onWheel={onSvgWheel}
              onTouchStart={onSvgTouchStart}
              onTouchMove={onSvgTouchMove}
              onTouchEnd={onSvgTouchEnd}
              onTouchCancel={onSvgTouchEnd}
              onClick={(e) => {
                // Click on empty SVG background → deselect.
                if (e.target === svgRef.current) setSelection(null);
              }}
            >
              {/* Background — the rendered PDF page */}
              <image href={pageImage.dataUrl} x={0} y={0} width={W} height={H} />

              {/* Title-block text substitutions — two draggable overlays.
                  Each starts at the auto-detected position from
                  findTextInPdfPage; once the user drags one its position
                  override gets stored in pathData and takes precedence on
                  future renders. Both are visible in edit AND view modes
                  so the user sees what the exported PDF will look like. */}
              {(() => {
                // Resolve effective positions (override > auto-detect).
                const titleBox = pathData.titleBoxOverride ?? siteplanTitlePos;
                const dateBox = pathData.dateBoxOverride ?? datePos;
                // Custom date wins over the auto-computed "today" value.
                const todayText = pathData.dateValueOverride ?? formatDateLikeOriginal(originalDateStr);
                return (
                  <>
                    {titleBox && (
                      <TitleBlockOverlay
                        box={titleBox}
                        text="LDAR OBSERVATION PLAN"
                        imgW={W}
                        imgH={H}
                        isEditMode={isEditMode}
                        onDragStart={startTitleboxDrag}
                      />
                    )}
                    {dateBox && (
                      <TitleBlockOverlay
                        box={dateBox}
                        text={todayText}
                        imgW={W}
                        imgH={H}
                        isEditMode={isEditMode}
                        onDragStart={startDateboxDrag}
                        editable
                        editing={editingDate}
                        editValue={dateInputValue}
                        onBeginEdit={() => beginEditDate(todayText)}
                        onEditChange={setDateInputValue}
                        onEditCommit={commitDateEdit}
                      />
                    )}
                    {/* User-added custom text/date fields. */}
                    {(pathData.customTextBoxes ?? []).map((b) => (
                      <TitleBlockOverlay
                        key={b.id}
                        box={b}
                        text={b.text}
                        imgW={W}
                        imgH={H}
                        isEditMode={isEditMode}
                        selected={selection?.kind === 'customText' && selection.id === b.id}
                        onDragStart={(e) => startCustomTextDrag(e, b.id)}
                        onResizeStart={(e) => startCustomTextResize(e, b.id)}
                        editable
                        editing={editingCustomTextId === b.id}
                        editValue={customTextInputValue}
                        onBeginEdit={() => {
                          setSelection({ kind: 'customText', id: b.id });
                          beginEditCustomText(b.id, b.text);
                        }}
                        onEditChange={setCustomTextInputValue}
                        onEditCommit={commitCustomTextEdit}
                      />
                    ))}
                  </>
                );
              })()}

              {/* Walking path */}
              {pathPoints.length >= 2 && (
                <>
                  {/* Dark outline behind the yellow stroke makes the dashes
                      visible against light-and-dark backgrounds alike. */}
                  <path
                    d={smoothPathD(pathPoints, W, H)}
                    fill="none"
                    stroke={VISUAL.pathOutline}
                    strokeWidth={VISUAL.pathStroke + 4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.5}
                    pointerEvents="none"
                  />
                  <path
                    d={smoothPathD(pathPoints, W, H)}
                    fill="none"
                    stroke={VISUAL.pathColor}
                    strokeWidth={VISUAL.pathStroke}
                    strokeDasharray={VISUAL.pathDash}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ cursor: isEditMode ? 'copy' : 'default' }}
                    onClick={handlePathClick}
                  />
                </>
              )}

              {/* Waypoints — only visible in edit mode */}
              {isEditMode &&
                waypoints.map((wp) => {
                  const isSelected = selection?.kind === 'waypoint' && selection.id === wp.id;
                  return (
                    <circle
                      key={wp.id}
                      cx={wp.x * W}
                      cy={wp.y * H}
                      r={VISUAL.waypointRadius}
                      fill={VISUAL.waypointFill}
                      stroke={isSelected ? '#1d4ed8' : VISUAL.waypointBorder}
                      strokeWidth={isSelected ? 3 : 2}
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => startWaypointDrag(e, wp.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelection({ kind: 'waypoint', id: wp.id });
                      }}
                    />
                  );
                })}

              {/* Numbered stops */}
              {stops.map((stop) => {
                const isSelected = selection?.kind === 'stop' && selection.id === stop.id;
                const isEditingNum = editingNumberOf === stop.id;
                const off = !!stop.offPath;
                // Off-path stops drop out of the route + export; in edit mode
                // we still draw a faded "ghost" marker so they can be
                // re-selected — to restore to the path or delete from legend.
                if (off && !isEditMode) return null;
                return (
                  <g
                    key={stop.id}
                    transform={`translate(${stop.x * W}, ${stop.y * H})`}
                    style={{ cursor: isEditMode ? 'grab' : 'default' }}
                    onPointerDown={(e) => startStopDrag(e, stop.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelection({ kind: 'stop', id: stop.id });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      beginEditNumber(stop);
                    }}
                  >
                    {/* Selection halo */}
                    {isSelected && (
                      <circle
                        r={VISUAL.stopRadius + 8}
                        fill="none"
                        stroke="#1d4ed8"
                        strokeWidth={3}
                        strokeDasharray="6 4"
                      />
                    )}
                    <circle
                      r={VISUAL.stopRadius}
                      fill={off ? 'rgba(220,38,38,0.18)' : VISUAL.stopFill}
                      stroke={off ? VISUAL.stopFill : VISUAL.stopBorderColor}
                      strokeWidth={off ? 2 : VISUAL.stopBorder}
                      strokeDasharray={off ? '4 3' : undefined}
                    />
                    {!isEditingNum && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={off ? VISUAL.stopFill : VISUAL.stopText}
                        fontSize={VISUAL.stopFontSize}
                        fontWeight={700}
                        fontFamily="system-ui, -apple-system, sans-serif"
                        pointerEvents="none"
                        opacity={off ? 0.85 : 1}
                      >
                        {stop.number}
                      </text>
                    )}
                    {isEditingNum && (
                      <foreignObject x={-VISUAL.stopRadius} y={-VISUAL.stopRadius} width={VISUAL.stopRadius * 2} height={VISUAL.stopRadius * 2}>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          value={numberInputValue}
                          onChange={(e) => setNumberInputValue(e.target.value.replace(/[^0-9]/g, ''))}
                          onBlur={commitNumberEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitNumberEdit();
                            if (e.key === 'Escape') setEditingNumberOf(null);
                          }}
                          style={{
                            width: '100%',
                            height: '100%',
                            textAlign: 'center',
                            fontSize: VISUAL.stopFontSize,
                            fontWeight: 700,
                            color: VISUAL.stopText,
                            background: VISUAL.stopFill,
                            border: 'none',
                            borderRadius: '50%',
                            outline: '2px solid #1d4ed8',
                            padding: 0,
                          }}
                        />
                      </foreignObject>
                    )}
                  </g>
                );
              })}

              {/* Legend */}
              {legendItems.length > 0 && (
                <Legend
                  legend={pathData.legend}
                  items={legendItems}
                  imgW={W}
                  imgH={H}
                  isEditMode={isEditMode}
                  selected={selection?.kind === 'legend'}
                  onMoveStart={startLegendMove}
                  onResizeStart={startLegendResize}
                  onSelect={() => setSelection({ kind: 'legend' })}
                  onTitleDoubleClick={() => isEditMode && setEditingLegendTitle(true)}
                  editingTitle={editingLegendTitle}
                  onTitleChange={(newTitle) => {
                    setPathData((prev) => ({ ...prev, legend: { ...prev.legend, title: newTitle } }));
                    setHasUnsavedChanges(true);
                  }}
                  onTitleBlur={() => setEditingLegendTitle(false)}
                  editingItemId={editingLegendItemId}
                  onItemDoubleClick={(id) => {
                    if (!isEditMode) return;
                    setEditingLegendItemId(id);
                  }}
                  onItemLabelChange={(id, label) => {
                    setPathData((prev) => ({
                      ...prev,
                      stops: prev.stops.map((s) => (s.id === id ? { ...s, label } : s)),
                    }));
                    setHasUnsavedChanges(true);
                  }}
                  onItemEditDone={() => setEditingLegendItemId(null)}
                />
              )}
            </svg>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ============================================================
// TitleBlockOverlay — draggable white-rect cover + replacement text.
// Used for the "FACILITY SITE PLAN → LDAR OBSERVATION PLAN" substitution
// and the date-cell substitution. Same shape for both because the
// behavior is identical; the caller picks the text content + position
// source.
// ============================================================
interface TitleBlockOverlayProps {
  box: { x: number; y: number; w: number; h: number };
  text: string;
  imgW: number;
  imgH: number;
  isEditMode: boolean;
  /** Pointer-down handler that starts a move drag. */
  onDragStart: (e: React.PointerEvent) => void;
  /** When true, double-clicking the overlay (in edit mode) edits its text. */
  editable?: boolean;
  /** True while this overlay's text is being inline-edited. */
  editing?: boolean;
  editValue?: string;
  onBeginEdit?: () => void;
  onEditChange?: (v: string) => void;
  onEditCommit?: () => void;
  /** Highlight as the current selection (solid outline vs the dashed hint). */
  selected?: boolean;
  /** When provided, a resize handle is shown (bottom-right) while selected. */
  onResizeStart?: (e: React.PointerEvent) => void;
}

function TitleBlockOverlay({
  box,
  text,
  imgW,
  imgH,
  isEditMode,
  onDragStart,
  editable = false,
  editing = false,
  editValue = '',
  onBeginEdit,
  onEditChange,
  onEditCommit,
  selected = false,
  onResizeStart,
}: TitleBlockOverlayProps) {
  const tx = box.x * imgW;
  const ty = box.y * imgH;
  const tw = box.w * imgW;
  const th = box.h * imgH;
  // Small horizontal pad only — vertical extent is already accurately
  // captured by findTextInPdfPage (after the fix to use top-of-cap as the
  // box top). Avoid extra Y pad to keep the cover from leaking into the
  // line below.
  const padX = th * 0.2;
  return (
    <g
      style={{ cursor: isEditMode ? 'move' : 'default' }}
      onPointerDown={isEditMode && !editing ? onDragStart : undefined}
      onDoubleClick={
        isEditMode && editable && onBeginEdit
          ? (e) => {
              e.stopPropagation();
              onBeginEdit();
            }
          : undefined
      }
    >
      {isEditMode && editable && !editing && (
        <title>Drag to reposition · Double-click to edit the date</title>
      )}
      <rect
        x={tx - padX}
        y={ty}
        width={tw + padX * 2}
        height={th}
        fill="#ffffff"
        // Outline shown only in edit mode — gives the user a visible
        // drag handle and a hint that it's interactive. A selected custom
        // box gets a solid, heavier outline.
        stroke={isEditMode ? (selected ? '#1d4ed8' : '#3b82f6') : 'none'}
        strokeWidth={isEditMode ? (selected ? 2.5 : 1.5) : 0}
        strokeDasharray={isEditMode && !selected ? '6 4' : undefined}
      />
      {editing ? (
        <foreignObject x={tx - padX} y={ty} width={tw + padX * 2} height={th}>
          <input
            type="text"
            autoFocus
            value={editValue}
            onChange={(e) => onEditChange?.(e.target.value)}
            onBlur={onEditCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEditCommit?.();
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              height: '100%',
              textAlign: 'center',
              fontSize: th * 0.7,
              fontWeight: 600,
              color: '#111827',
              fontFamily: 'system-ui, -apple-system, Helvetica, Arial, sans-serif',
              border: '1px solid #3b82f6',
              borderRadius: 3,
              padding: 0,
              background: '#ffffff',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </foreignObject>
      ) : (
        <text
          x={tx + tw / 2}
          y={ty + th * 0.55}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#111827"
          // Bumped 0.72 → 0.85 per Israel — the previous multiplier ran
          // visibly smaller than the surrounding title-block text.
          fontSize={th * 0.85}
          fontWeight={600}
          fontFamily="system-ui, -apple-system, Helvetica, Arial, sans-serif"
          pointerEvents="none"
        >
          {text}
        </text>
      )}
      {/* Resize handle (bottom-right) — only on the selected field in edit
          mode. Dragging it changes the box width + height (height drives the
          font size, so this is how you make the field smaller). */}
      {isEditMode && selected && onResizeStart && !editing && (() => {
        const hs = Math.max(10, th * 0.6);
        return (
          <rect
            x={tx + tw + padX - hs / 2}
            y={ty + th - hs / 2}
            width={hs}
            height={hs}
            fill="#1d4ed8"
            stroke="#ffffff"
            strokeWidth={Math.max(1, hs * 0.12)}
            style={{ cursor: 'nwse-resize' }}
            onPointerDown={onResizeStart}
          />
        );
      })()}
    </g>
  );
}

// ============================================================
// Legend sub-component — kept inline so the editor file is one stop shop.
// ============================================================
interface LegendProps {
  legend: { x: number; y: number; w: number; h: number; title?: string };
  items: LDARObservationPathStop[];
  imgW: number;
  imgH: number;
  isEditMode: boolean;
  selected: boolean;
  onMoveStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onSelect: () => void;
  onTitleDoubleClick: () => void;
  editingTitle: boolean;
  onTitleChange: (v: string) => void;
  onTitleBlur: () => void;
  /** Stop id whose label is currently being edited in-place from inside
   *  the legend. Null = nothing being edited. */
  editingItemId: string | null;
  /** Called when the user double-clicks a legend item's text in edit
   *  mode. Parent decides whether to enter edit mode (only in edit
   *  mode). */
  onItemDoubleClick: (id: string) => void;
  /** Called on every keystroke while the textarea is open. */
  onItemLabelChange: (id: string, label: string) => void;
  /** Called when the textarea blurs / Enter is pressed — parent clears
   *  the editingItemId. */
  onItemEditDone: () => void;
}

function Legend({
  legend,
  items,
  imgW,
  imgH,
  isEditMode,
  selected,
  onMoveStart,
  onResizeStart,
  onSelect,
  onTitleDoubleClick,
  editingTitle,
  onTitleChange,
  onTitleBlur,
  editingItemId,
  onItemDoubleClick,
  onItemLabelChange,
  onItemEditDone,
}: LegendProps) {
  const x = legend.x * imgW;
  const y = legend.y * imgH;
  const w = legend.w * imgW;
  // User-set height is a MINIMUM. The rendered height grows to fit
  // wrapped items so labels never get clipped at the right edge.
  const minH = legend.h * imgH;

  // Font sizes are capped — without caps, a tall legend produced 60+ vbox-unit
  // title text that looked enormous on screen. Caps keep output sensible at
  // any legend size; user can scale up by zooming the page render scale.
  // Item font bumped 16 → 20 cap with a higher floor; items also render bold
  // for closer parity with the title's visual weight.
  const titleFontSize = Math.min(28, Math.max(16, w * 0.05));
  const itemFontSize = Math.min(20, Math.max(13, w * 0.032));
  const titleHeight = Math.max(32, titleFontSize * 1.8);

  // Per-item geometry. The numbered circle is a fixed visual size relative
  // to the item font; gap between circle and label is constant.
  const circleR = Math.max(9, itemFontSize * 0.85);
  const itemPadX = 10;
  const itemGap = 8;
  const labelLeft = x + itemPadX + circleR * 2 + itemGap;
  const labelMaxWidth = Math.max(40, x + w - labelLeft - itemPadX);

  // Approximate width per character for system-ui sans-serif. Slightly
  // generous so we don't under-allocate height for wrapped lines.
  // Bold text (fontWeight: 600) is ~7% wider per glyph than regular —
  // 0.62 accounts for that so the line-wrap estimate doesn't
  // under-allocate height.
  const approxCharWidth = itemFontSize * 0.62;
  const charsPerLine = Math.max(6, Math.floor(labelMaxWidth / approxCharWidth));
  const estimateLines = (text: string) => {
    if (!text) return 1;
    // Approximate wrap: total chars / chars-per-line, rounded up. Slightly
    // generous so labels with long unbreakable tokens still get enough
    // vertical room.
    return Math.max(1, Math.ceil((text.length + 1) / charsPerLine));
  };
  const itemHeight = (text: string) => {
    const textHeight = estimateLines(text) * itemFontSize * 1.3;
    return Math.max(circleR * 2 + 8, textHeight + 8);
  };

  // Sum item heights to compute the effective legend height.
  const totalItemsHeight = items.reduce((sum, it) => sum + itemHeight(it.label), 0);
  const contentH = titleHeight + totalItemsHeight + 8; // titleHeight + items + bottom pad
  const h = Math.max(minH, contentH);

  // Stream items into y positions using their per-item heights.
  let cursor = y + titleHeight + 4;
  const itemLayout = items.map((it) => {
    const ih = itemHeight(it.label);
    const top = cursor;
    cursor += ih;
    return { item: it, top, height: ih };
  });

  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{ cursor: isEditMode ? 'move' : 'default' }}
    >
      {/* Background box — sized to effective height (≥ user-set min). */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={VISUAL.legendBg}
        stroke={VISUAL.legendBorder}
        strokeWidth={3}
        rx={6}
        ry={6}
        onPointerDown={onMoveStart}
      />

      {/* Title */}
      {!editingTitle ? (
        <text
          x={x + w / 2}
          y={y + titleHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={VISUAL.legendBorder}
          fontSize={titleFontSize}
          fontWeight={700}
          fontFamily="system-ui, -apple-system, sans-serif"
          pointerEvents="none"
          onDoubleClick={onTitleDoubleClick}
        >
          {legend.title || 'LDAR OBSERVATION PATH'}
        </text>
      ) : (
        <foreignObject x={x + 6} y={y + 4} width={w - 12} height={titleHeight - 6}>
          <input
            autoFocus
            value={legend.title || ''}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onTitleBlur();
            }}
            style={{
              width: '100%',
              height: '100%',
              border: '1px solid #dc2626',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: titleFontSize,
              fontWeight: 700,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: VISUAL.legendBorder,
              textAlign: 'center',
            }}
          />
        </foreignObject>
      )}

      {/* Divider under title */}
      <line
        x1={x + 8}
        x2={x + w - 8}
        y1={y + titleHeight}
        y2={y + titleHeight}
        stroke={VISUAL.legendBorder}
        strokeWidth={1.5}
        opacity={0.4}
        pointerEvents="none"
      />

      {/* Items — numbered red circle in SVG + wrapping label via
          foreignObject + HTML. The circle stays SVG because it's
          a precise geometric element; the label uses HTML so the
          browser does word-wrap natively when text exceeds
          labelMaxWidth. */}
      {itemLayout.map(({ item, top, height: ih }) => {
        const cy = top + ih / 2;
        const cx = x + itemPadX + circleR;
        const isEditingThis = editingItemId === item.id;
        // The circle is always pointer-events-none; the label foreignObject
        // becomes interactive in edit mode so double-click can trigger
        // inline text editing. Outside edit mode, the whole group stays
        // inert so it doesn't fight the legend's move/select handlers.
        return (
          <g key={item.id}>
            <g pointerEvents="none">
              <circle
                cx={cx}
                cy={cy}
                r={circleR}
                fill={VISUAL.legendNumberFill}
              />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#ffffff"
                fontSize={circleR * 1.05}
                fontWeight={700}
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {item.number}
              </text>
            </g>
            <foreignObject
              x={labelLeft}
              y={top}
              width={labelMaxWidth}
              height={ih}
              // Only the LABEL area is interactive — circle stays inert
              // so it can't accidentally start an edit by misclick.
              pointerEvents={isEditMode ? 'auto' : 'none'}
            >
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: itemFontSize,
                  fontWeight: 600,
                  lineHeight: 1.25,
                  color: '#111827',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  wordBreak: 'normal',
                  overflowWrap: 'break-word',
                }}
              >
                {isEditingThis ? (
                  <textarea
                    autoFocus
                    value={item.label}
                    onChange={(e) => onItemLabelChange(item.id, e.target.value)}
                    onBlur={onItemEditDone}
                    onKeyDown={(e) => {
                      // Enter (without shift) commits; Escape also commits
                      // — the user can undo from the toolbar if they
                      // didn't mean it.
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        onItemEditDone();
                      } else if (e.key === 'Escape') {
                        onItemEditDone();
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      minHeight: itemFontSize * 1.4,
                      padding: '2px 4px',
                      border: '1px solid #3b82f6',
                      borderRadius: 3,
                      fontSize: itemFontSize,
                      fontWeight: 600,
                      lineHeight: 1.25,
                      color: '#111827',
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      resize: 'vertical',
                      // Wrap mode so the textarea matches the wrapped span
                      // visually instead of producing a single long line.
                      whiteSpace: 'pre-wrap',
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onItemDoubleClick(item.id);
                    }}
                    style={{
                      width: '100%',
                      cursor: isEditMode ? 'text' : 'inherit',
                      // Subtle hover hint in edit mode that the text is editable.
                      ...(isEditMode
                        ? {
                            borderBottom: '1px dashed transparent',
                            transition: 'border-bottom-color 120ms',
                          }
                        : {}),
                    }}
                    title={isEditMode ? 'Double-click to edit this label' : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </div>
            </foreignObject>
          </g>
        );
      })}

      {/* Resize handle (bottom-right) — anchored to the EFFECTIVE
          height so it stays at the visible bottom corner. */}
      {isEditMode && (
        <rect
          x={x + w - 14}
          y={y + h - 14}
          width={14}
          height={14}
          fill={VISUAL.legendBorder}
          stroke="#ffffff"
          strokeWidth={2}
          rx={2}
          ry={2}
          style={{ cursor: 'nwse-resize' }}
          onPointerDown={onResizeStart}
        />
      )}

      {/* Selection outline */}
      {selected && isEditMode && (
        <rect
          x={x - 4}
          y={y - 4}
          width={w + 8}
          height={h + 8}
          fill="none"
          stroke="#1d4ed8"
          strokeWidth={2}
          strokeDasharray="6 4"
          rx={8}
          ry={8}
          pointerEvents="none"
        />
      )}
    </g>
  );
}
