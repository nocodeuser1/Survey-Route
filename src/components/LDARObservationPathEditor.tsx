import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
} from 'lucide-react';
import {
  supabase,
  type Facility,
  type LDARObservationPathData,
  type LDARObservationPathStop,
  type LDARObservationPathWaypoint,
} from '../lib/supabase';
import { renderPdfPageToImage } from '../utils/renderPdfPageToImage';
import {
  findTextInPdfPage,
  findDateInPdfPage,
  type TextBoundingBox,
} from '../utils/findTextInPdfPage';
import { svgToPdfBlob } from '../utils/svgToPdfBlob';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
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
  const sorted = sortStops(stops);
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
    const match = originalDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (match) {
      const yearDigits = match[3].length;
      const y = yearDigits === 2 ? twoYear : String(fullYear);
      return `${m}/${d}/${y}`;
    }
  }
  return `${m}/${d}/${twoYear}`;
}

/** Default empty path data. */
function emptyPathData(): LDARObservationPathData {
  return { stops: [], waypoints: [], legend: { x: 0.04, y: 0.82, w: 0.42, h: 0.14, title: 'LDAR OBSERVATION PATH' } };
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
}

type DragKind =
  | { kind: 'stop'; id: string }
  | { kind: 'waypoint'; id: string }
  | { kind: 'legend-move' }
  | { kind: 'legend-resize' }
  | { kind: 'titlebox-move' }
  | { kind: 'datebox-move' }
  | null;

type SelectionKind =
  | { kind: 'stop'; id: string }
  | { kind: 'waypoint'; id: string }
  | { kind: 'legend' }
  | null;

export default function LDARObservationPathEditor({
  facility,
  darkMode,
  onClose,
  onSaved,
  autoGenerate = false,
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

  // View / edit mode + selection.
  const [isEditMode, setIsEditMode] = useState(false);
  const [selection, setSelection] = useState<SelectionKind>(null);
  const [editingNumberOf, setEditingNumberOf] = useState<string | null>(null);
  const [numberInputValue, setNumberInputValue] = useState('');
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
        const rendered = await renderPdfPageToImage(facility.ldar_site_plan_url, { scale: 2 });
        if (cancelled) return;
        setPageImage({ dataUrl: rendered.dataUrl, w: rendered.width, h: rendered.height });

        // Also extract title-block text positions from the source PDF so
        // the export can substitute "LDAR OBSERVATION PLAN" in place of
        // "FACILITY SITE PLAN" and overwrite the date cell with today.
        // Best-effort — if anything fails we just skip the overlay.
        try {
          const arrayBuffer = await (await fetch(facility.ldar_site_plan_url!)).arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
  }, [facility.ldar_site_plan_url]);

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
          imageBase64: pageImage.dataUrl,
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
        imageSize: { w: pageImage.w, h: pageImage.h },
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

      // 2. PDF — render the editor SVG (which already includes the
      //    background page image + walking-path overlay + title-block
      //    text substitution) to a flat single-page PDF and overwrite
      //    the storage file. Wrapped in its own try so a PDF failure
      //    doesn't undo a successful JSON save.
      if (svgRef.current && pageImage) {
        setSaveStage('pdf');
        try {
          const pdfBlob = await svgToPdfBlob(svgRef.current, pageImage.w, pageImage.h);
          const storagePath = `${facility.id}/site-plan.pdf`;
          const { error: uploadError } = await supabase.storage
            .from('ldar-site-plans')
            .upload(storagePath, pdfBlob, {
              contentType: 'application/pdf',
              upsert: true,
              cacheControl: '60',
            });
          if (uploadError) throw uploadError;
          // Bump uploaded_at so the LDAR Site Plan section can use it as
          // a cache-buster on the public URL.
          const nowIso = new Date().toISOString();
          const { error: tsErr } = await supabase
            .from('facilities')
            .update({ ldar_site_plan_uploaded_at: nowIso })
            .eq('id', facility.id);
          if (tsErr) throw tsErr;
          Object.assign(facility, { ldar_site_plan_uploaded_at: nowIso });
        } catch (pdfErr) {
          console.warn('Annotated PDF generation failed (JSON was saved):', pdfErr);
          setSaveError(
            (pdfErr instanceof Error ? pdfErr.message : 'Annotated PDF generation failed') +
              ' — your path JSON was saved successfully; you can re-save to retry the PDF.',
          );
        }
      }

      setHasUnsavedChanges(false);
      onSaved();
    } catch (err) {
      console.error('Save failed', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setIsSaving(false);
      setSaveStage('idle');
    }
  }, [pathData, facility, onSaved, pageImage]);

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
            onClick={onClose}
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
                onClick={deleteSelected}
                disabled={!selection || selection.kind === 'legend'}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                  darkMode
                    ? 'bg-red-900/40 hover:bg-red-900/60 text-red-200 border border-red-900/60'
                    : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={selection ? 'Delete the selected stop/waypoint' : 'Select a stop or waypoint to delete'}
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
            disabled={isSaving || !hasUnsavedChanges}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isSaving || !hasUnsavedChanges
                ? 'bg-emerald-500/40 text-white cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
            title={hasUnsavedChanges ? 'Save changes + bake the annotated PDF' : 'No unsaved changes'}
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
          <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Double-click the circle to edit its number
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

      {/* Canvas area */}
      <div className="flex-1 overflow-auto p-3 flex items-start justify-center">
        {isLoadingPage ? (
          <div className="flex flex-col items-center gap-3 text-white py-20">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Loading LDAR site plan…</p>
          </div>
        ) : !pageImage ? (
          <div className="text-white py-20 text-center max-w-md">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-yellow-400" />
            <p className="text-sm">
              {loadError || 'Upload an LDAR site plan PDF to start drawing a walking path.'}
            </p>
          </div>
        ) : (
          <div
            className={`relative shadow-2xl ${darkMode ? 'bg-gray-950' : 'bg-white'} ${
              isEditMode ? 'cursor-crosshair' : 'cursor-default'
            }`}
            style={{ maxWidth: '100%', width: '100%' }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="xMidYMid meet"
              className="w-full h-auto select-none touch-none"
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerCancel={onSvgPointerUp}
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
                const todayText = formatDateLikeOriginal(originalDateStr);
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
                      />
                    )}
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
                      fill={VISUAL.stopFill}
                      stroke={VISUAL.stopBorderColor}
                      strokeWidth={VISUAL.stopBorder}
                    />
                    {!isEditingNum && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={VISUAL.stopText}
                        fontSize={VISUAL.stopFontSize}
                        fontWeight={700}
                        fontFamily="system-ui, -apple-system, sans-serif"
                        pointerEvents="none"
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
}

function TitleBlockOverlay({
  box,
  text,
  imgW,
  imgH,
  isEditMode,
  onDragStart,
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
      onPointerDown={isEditMode ? onDragStart : undefined}
    >
      <rect
        x={tx - padX}
        y={ty}
        width={tw + padX * 2}
        height={th}
        fill="#ffffff"
        // Outline shown only in edit mode — gives the user a visible
        // drag handle and a hint that it's interactive.
        stroke={isEditMode ? '#3b82f6' : 'none'}
        strokeWidth={isEditMode ? 1.5 : 0}
        strokeDasharray={isEditMode ? '6 4' : undefined}
      />
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
