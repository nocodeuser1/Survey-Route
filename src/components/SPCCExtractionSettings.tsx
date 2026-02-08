import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Check, AlertTriangle, ChevronLeft, ChevronRight, Loader, Save, Trash2, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type ExtractionRegion = { x: number; y: number; width: number; height: number };

interface FieldExtractionConfig {
  page: number;
  anchor_text: string;
  anchor_region: ExtractionRegion;
  value_offset: { dx: number; dy: number };
  value_size: { width: number; height: number };
  multi_line?: boolean;
}

interface ExtractionConfig {
  facility_name: FieldExtractionConfig;
  pe_stamp_date: FieldExtractionConfig;
}

interface SPCCExtractionSettingsProps {
  accountId: string;
  authUserId: string;
}

export default function SPCCExtractionSettings({ accountId, authUserId }: SPCCExtractionSettingsProps) {
  const { darkMode } = useDarkMode();
  const [step, setStep] = useState<'upload' | 'configure'>('upload');
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  const [activeField, setActiveField] = useState<'facility_name' | 'pe_stamp_date'>('facility_name');
  const [drawingStep, setDrawingStep] = useState<'anchor' | 'value'>('anchor');

  // Facility Name field
  const [fnPage, setFnPage] = useState(1);
  const [fnAnchorRegion, setFnAnchorRegion] = useState<ExtractionRegion | null>(null);
  const [fnAnchorText, setFnAnchorText] = useState('');
  const [fnValueRegion, setFnValueRegion] = useState<ExtractionRegion | null>(null);
  const [fnValueText, setFnValueText] = useState('');
  const [fnMultiLine, setFnMultiLine] = useState(false);

  // PE Stamp Date field
  const [pdPage, setPdPage] = useState(1);
  const [pdAnchorRegion, setPdAnchorRegion] = useState<ExtractionRegion | null>(null);
  const [pdAnchorText, setPdAnchorText] = useState('');
  const [pdValueRegion, setPdValueRegion] = useState<ExtractionRegion | null>(null);
  const [pdValueText, setPdValueText] = useState('');
  const [pdMultiLine, setPdMultiLine] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedConfig, setSavedConfig] = useState<ExtractionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<ExtractionRegion | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived state for active field
  const anchorRegion = activeField === 'facility_name' ? fnAnchorRegion : pdAnchorRegion;
  const anchorText = activeField === 'facility_name' ? fnAnchorText : pdAnchorText;
  const valueRegion = activeField === 'facility_name' ? fnValueRegion : pdValueRegion;
  const valueText = activeField === 'facility_name' ? fnValueText : pdValueText;
  const multiLine = activeField === 'facility_name' ? fnMultiLine : pdMultiLine;
  const fnComplete = !!fnAnchorRegion && !!fnValueRegion;
  const pdComplete = !!pdAnchorRegion && !!pdValueRegion;
  const canSave = fnComplete && pdComplete;

  // Load existing config
  useEffect(() => {
    const loadConfig = async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('spcc_extraction_config')
        .eq('account_id', accountId)
        .single();

      if (data?.spcc_extraction_config) {
        const config = data.spcc_extraction_config as ExtractionConfig;
        setSavedConfig(config);
        if (config.facility_name) {
          const fn = config.facility_name;
          setFnPage(fn.page);
          setFnAnchorRegion(fn.anchor_region);
          setFnAnchorText(fn.anchor_text);
          setFnValueRegion({
            x: fn.anchor_region.x + fn.value_offset.dx,
            y: fn.anchor_region.y + fn.value_offset.dy,
            width: fn.value_size.width,
            height: fn.value_size.height,
          });
          setFnMultiLine(fn.multi_line ?? false);
        }
        if (config.pe_stamp_date) {
          const pd = config.pe_stamp_date;
          setPdPage(pd.page);
          setPdAnchorRegion(pd.anchor_region);
          setPdAnchorText(pd.anchor_text);
          setPdValueRegion({
            x: pd.anchor_region.x + pd.value_offset.dx,
            y: pd.anchor_region.y + pd.value_offset.dy,
            width: pd.value_size.width,
            height: pd.value_size.height,
          });
          setPdMultiLine(pd.multi_line ?? false);
        }
      }
      setLoading(false);
    };
    loadConfig();
  }, [accountId]);

  // Load PDF document
  const loadPdf = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    setPdfDoc(doc);
    setPageCount(doc.numPages);
    setCurrentPage(1);
    setStep('configure');
  };

  // Render PDF page to canvas
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current) return;

    const page = await pdfDoc.getPage(pageNum);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    const containerWidth = containerRef.current?.clientWidth || 600;
    const viewport = page.getViewport({ scale: 1 });
    const scale = (containerWidth - 40) / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    setCanvasSize({ width: scaledViewport.width, height: scaledViewport.height });

    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

    if (overlayRef.current) {
      overlayRef.current.width = scaledViewport.width;
      overlayRef.current.height = scaledViewport.height;
    }
  }, [pdfDoc]);

  useEffect(() => {
    if (pdfDoc && currentPage > 0) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, renderPage]);

  // Draw overlay with regions
  const drawOverlay = useCallback(() => {
    if (!overlayRef.current) return;
    const ctx = overlayRef.current.getContext('2d')!;
    const { width, height } = canvasSize;
    ctx.clearRect(0, 0, width, height);

    const drawRegion = (region: ExtractionRegion, color: string, label: string, dashed: boolean) => {
      const x = region.x * width;
      const y = region.y * height;
      const w = region.width * width;
      const h = region.height * height;

      ctx.fillStyle = color + (dashed ? '1a' : '33');
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [6, 3] : []);
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(label, x + 4, y - 4);
      ctx.setLineDash([]);
    };

    // Facility Name regions
    if (fnAnchorRegion && fnPage === currentPage) {
      drawRegion(fnAnchorRegion, '#3b82f6', 'Anchor: Facility Name', true);
    }
    if (fnValueRegion && fnPage === currentPage) {
      drawRegion(fnValueRegion, '#3b82f6', 'Value: Facility Name', false);
    }

    // PE Stamp Date regions
    if (pdAnchorRegion && pdPage === currentPage) {
      drawRegion(pdAnchorRegion, '#10b981', 'Anchor: PE Date', true);
    }
    if (pdValueRegion && pdPage === currentPage) {
      drawRegion(pdValueRegion, '#10b981', 'Value: PE Date', false);
    }

    // Current drawing
    if (currentRect) {
      const color = activeField === 'facility_name' ? '#3b82f6' : '#10b981';
      const label = drawingStep === 'anchor' ? 'Anchor' : 'Value';
      drawRegion(currentRect, color, label, drawingStep === 'anchor');
    }
  }, [canvasSize, fnAnchorRegion, fnValueRegion, fnPage, pdAnchorRegion, pdValueRegion, pdPage, currentPage, currentRect, activeField, drawingStep]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Mouse handlers for drawing regions
  const getRelativePos = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / canvasSize.width,
      y: (e.clientY - rect.top) / canvasSize.height,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getRelativePos(e);
    setDrawing(true);
    setDrawStart(pos);
    setCurrentRect(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !drawStart) return;
    const pos = getRelativePos(e);
    setCurrentRect({
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      width: Math.abs(pos.x - drawStart.x),
      height: Math.abs(pos.y - drawStart.y),
    });
  };

  const handleMouseUp = async () => {
    if (!drawing || !currentRect) {
      setDrawing(false);
      return;
    }
    setDrawing(false);

    if (currentRect.width < 0.01 || currentRect.height < 0.005) {
      setCurrentRect(null);
      return;
    }

    const text = await extractTextFromRegion(currentPage, currentRect);

    // Mark as unsaved when regions change
    setSavedConfig(null);

    if (drawingStep === 'anchor') {
      if (activeField === 'facility_name') {
        setFnAnchorRegion(currentRect);
        setFnAnchorText(text);
        setFnPage(currentPage);
        // Clear value when anchor changes since the offset will be different
        setFnValueRegion(null);
        setFnValueText('');
      } else {
        setPdAnchorRegion(currentRect);
        setPdAnchorText(text);
        setPdPage(currentPage);
        setPdValueRegion(null);
        setPdValueText('');
      }
      // Auto-advance to value step
      setDrawingStep('value');
    } else {
      if (activeField === 'facility_name') {
        setFnValueRegion(currentRect);
        setFnValueText(text);
      } else {
        setPdValueRegion(currentRect);
        setPdValueText(text);
      }
    }
    setCurrentRect(null);
  };

  // Extract text from a specific region
  const extractTextFromRegion = async (pageNum: number, region: ExtractionRegion): Promise<string> => {
    if (!pdfDoc) return '';
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const regionLeft = region.x * viewport.width;
    const regionTop = region.y * viewport.height;
    const regionRight = (region.x + region.width) * viewport.width;
    const regionBottom = (region.y + region.height) * viewport.height;

    const matchingItems = textContent.items.filter((item: any) => {
      if (!item.transform) return false;
      const [, , , , tx, ty] = item.transform;
      const itemHeight = item.height || 12;
      const itemTop = viewport.height - ty;
      const itemBottom = itemTop + itemHeight;
      const itemLeft = tx;
      const itemRight = tx + (item.width || 0);

      return itemLeft < regionRight && itemRight > regionLeft &&
             itemTop < regionBottom && itemBottom > regionTop;
    });

    return matchingItems.map((item: any) => item.str).join(' ').trim();
  };

  const handleSave = async () => {
    if (!fnAnchorRegion || !fnValueRegion || !pdAnchorRegion || !pdValueRegion) return;
    setSaving(true);

    const config: ExtractionConfig = {
      facility_name: {
        page: fnPage,
        anchor_text: fnAnchorText,
        anchor_region: fnAnchorRegion,
        value_offset: {
          dx: fnValueRegion.x - fnAnchorRegion.x,
          dy: fnValueRegion.y - fnAnchorRegion.y,
        },
        value_size: {
          width: fnValueRegion.width,
          height: fnValueRegion.height,
        },
        multi_line: fnMultiLine,
      },
      pe_stamp_date: {
        page: pdPage,
        anchor_text: pdAnchorText,
        anchor_region: pdAnchorRegion,
        value_offset: {
          dx: pdValueRegion.x - pdAnchorRegion.x,
          dy: pdValueRegion.y - pdAnchorRegion.y,
        },
        value_size: {
          width: pdValueRegion.width,
          height: pdValueRegion.height,
        },
        multi_line: pdMultiLine,
      },
    };

    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: authUserId,
          account_id: accountId,
          spcc_extraction_config: config,
        }, { onConflict: 'user_id' });

      if (error) throw error;
      setSavedConfig(config);
      // Stay on configure step so the PDF + regions remain visible
    } catch (err) {
      console.error('Error saving extraction config:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClearConfig = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('user_settings')
        .update({ spcc_extraction_config: null })
        .eq('account_id', accountId);

      if (error) throw error;
      setSavedConfig(null);
      setFnAnchorRegion(null);
      setFnAnchorText('');
      setFnValueRegion(null);
      setFnValueText('');
      setFnMultiLine(false);
      setPdAnchorRegion(null);
      setPdAnchorText('');
      setPdValueRegion(null);
      setPdValueText('');
      setPdMultiLine(false);
      setDrawingStep('anchor');
      setStep('upload');
      setPdfDoc(null);
    } catch (err) {
      console.error('Error clearing config:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleResetField = () => {
    if (activeField === 'facility_name') {
      setFnAnchorRegion(null);
      setFnAnchorText('');
      setFnValueRegion(null);
      setFnValueText('');
    } else {
      setPdAnchorRegion(null);
      setPdAnchorText('');
      setPdValueRegion(null);
      setPdValueText('');
    }
    setDrawingStep('anchor');
  };

  // When switching fields, set drawingStep based on current state
  const switchToField = (field: 'facility_name' | 'pe_stamp_date') => {
    setActiveField(field);
    const anchor = field === 'facility_name' ? fnAnchorRegion : pdAnchorRegion;
    const value = field === 'facility_name' ? fnValueRegion : pdValueRegion;
    const page = field === 'facility_name' ? fnPage : pdPage;

    if (!anchor) {
      setDrawingStep('anchor');
    } else if (!value) {
      setDrawingStep('value');
    } else {
      setDrawingStep('value');
    }

    if (anchor) {
      setCurrentPage(page);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className={`w-6 h-6 animate-spin ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          SPCC Plan Extraction
        </h3>
        <p className={`text-sm mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Configure how facility names and PE stamp dates are extracted from your SPCC plan PDFs during bulk import.
          Upload a sample PDF, then define an anchor label and a value region for each field.
        </p>
      </div>

      {/* Current config status */}
      {savedConfig && (
        <div className={`rounded-lg border p-4 ${darkMode ? 'border-green-900/50 bg-green-900/20' : 'border-green-200 bg-green-50'}`}>
          <div className="flex items-start gap-3">
            <Check className={`w-5 h-5 mt-0.5 flex-shrink-0 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${darkMode ? 'text-green-300' : 'text-green-800'}`}>
                Extraction regions configured
              </p>
              <div className={`text-xs mt-1 space-y-0.5 ${darkMode ? 'text-green-400/80' : 'text-green-700'}`}>
                <p>
                  Facility Name: Page {savedConfig.facility_name.page}, anchor &ldquo;{savedConfig.facility_name.anchor_text}&rdquo;
                  {savedConfig.facility_name.multi_line ? ' (multi-line)' : ''}
                </p>
                <p>
                  PE Stamp Date: Page {savedConfig.pe_stamp_date.page}, anchor &ldquo;{savedConfig.pe_stamp_date.anchor_text}&rdquo;
                  {savedConfig.pe_stamp_date.multi_line ? ' (multi-line)' : ''}
                </p>
              </div>
              <div className="flex gap-2 mt-3">
                {step !== 'configure' && (
                  <button
                    onClick={() => {
                      if (pdfDoc) setStep('configure');
                      else setStep('upload');
                    }}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium ${darkMode
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                  >
                    Reconfigure
                  </button>
                )}
                {step === 'configure' && (
                  <button
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium ${darkMode
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                  >
                    <Upload className="w-3 h-3 inline mr-1" />
                    Use Different PDF
                  </button>
                )}
                <button
                  onClick={handleClearConfig}
                  disabled={saving}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium ${darkMode
                    ? 'text-red-400 hover:bg-red-900/30'
                    : 'text-red-600 hover:bg-red-50'
                    }`}
                >
                  <Trash2 className="w-3 h-3 inline mr-1" />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Upload sample PDF */}
      {step === 'upload' && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${darkMode
            ? 'border-gray-600 hover:border-gray-500'
            : 'border-gray-300 hover:border-gray-400'
            }`}
        >
          <Upload className={`w-10 h-10 mx-auto mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
          <p className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            Upload a sample SPCC plan PDF
          </p>
          <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            This PDF will be used to define extraction regions. It is not stored.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) loadPdf(e.target.files[0]);
            }}
          />
        </div>
      )}

      {/* Step 2: Configure regions */}
      {step === 'configure' && pdfDoc && (
        <div className="space-y-4">
          {/* Field selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Field:</span>
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 p-0.5">
              <button
                onClick={() => switchToField('facility_name')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeField === 'facility_name'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : (darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700')
                  }`}
              >
                Facility Name
                {fnComplete && <Check className="w-3 h-3 inline ml-1" />}
              </button>
              <button
                onClick={() => switchToField('pe_stamp_date')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeField === 'pe_stamp_date'
                  ? 'bg-green-600 text-white shadow-sm'
                  : (darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700')
                  }`}
              >
                PE Stamp Date
                {pdComplete && <Check className="w-3 h-3 inline ml-1" />}
              </button>
            </div>

            {/* Page navigation */}
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className={`p-1.5 rounded transition-colors disabled:opacity-30 ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className={`text-xs font-medium min-w-[60px] text-center ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Page {currentPage} / {pageCount}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
                disabled={currentPage >= pageCount}
                className={`p-1.5 rounded transition-colors disabled:opacity-30 ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Drawing step selector */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Step:</span>
            <button
              onClick={() => setDrawingStep('anchor')}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${drawingStep === 'anchor'
                ? (darkMode ? 'bg-gray-600 text-white' : 'bg-gray-200 text-gray-900')
                : (darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')
                }`}
            >
              1. Anchor {anchorRegion ? '\u2713' : ''}
            </button>
            <button
              onClick={() => { if (anchorRegion) setDrawingStep('value'); }}
              disabled={!anchorRegion}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all disabled:opacity-30 ${drawingStep === 'value'
                ? (darkMode ? 'bg-gray-600 text-white' : 'bg-gray-200 text-gray-900')
                : (darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600')
                }`}
            >
              2. Value {valueRegion ? '\u2713' : ''}
            </button>

            {(anchorRegion || valueRegion) && (
              <button
                onClick={handleResetField}
                className={`text-xs px-2 py-1 rounded-md ml-2 ${darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
                title="Reset this field"
              >
                <RotateCcw className="w-3 h-3 inline mr-0.5" />
                Reset
              </button>
            )}
          </div>

          {/* Instruction & tips */}
          <div className={`rounded-lg p-3 space-y-2 ${darkMode ? 'bg-blue-900/20 border border-blue-900/30' : 'bg-blue-50 border border-blue-100'}`}>
            {drawingStep === 'anchor' ? (
              <>
                <p className={`text-xs font-medium ${darkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                  Step 1: Draw a box around the <strong>label text</strong> for {activeField === 'facility_name' ? 'the facility name' : 'the PE stamp date'}.
                </p>
                <div className={`text-xs space-y-1 ${darkMode ? 'text-blue-400/80' : 'text-blue-600'}`}>
                  <p>Tips:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Select the static label that appears in every PDF (e.g. &ldquo;{activeField === 'facility_name' ? 'Facility Name:' : 'PE Stamp Date:'}&rdquo;).</li>
                    <li>This label acts as an anchor — the extractor will find it in each PDF and use its position to locate the value nearby.</li>
                    <li>Choose text that never changes between PDFs.</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <p className={`text-xs font-medium ${darkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                  Step 2: Draw a box around where the <strong>actual value</strong> appears for {activeField === 'facility_name' ? 'the facility name' : 'the PE stamp date'}.
                </p>
                <div className={`text-xs space-y-1 ${darkMode ? 'text-blue-400/80' : 'text-blue-600'}`}>
                  <p>Tips:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {activeField === 'facility_name' ? (
                      <>
                        <li>Draw the box large enough to cover the longest facility name across all your SPCC plans.</li>
                        <li>It&apos;s better to select too large an area than too small — extra whitespace won&apos;t affect matching.</li>
                        <li>If names can wrap to a second line, enable &ldquo;Multi-line&rdquo; below and make the box tall enough for two lines.</li>
                      </>
                    ) : (
                      <>
                        <li>Draw the box around where the date value appears.</li>
                        <li>The extractor looks for date patterns (e.g. 01/18/2017) within the selected region.</li>
                        <li>If the date may appear alongside other text on multiple lines, enable &ldquo;Multi-line&rdquo; below.</li>
                      </>
                    )}
                    <li>The value position is stored relative to the anchor, so if the anchor label moves in other PDFs, the value region moves with it.</li>
                  </ul>
                </div>
              </>
            )}
          </div>

          {/* Multi-line option (only for value step) */}
          {drawingStep === 'value' && (
            <div className="flex items-center gap-4">
              <label className={`flex items-center gap-2 text-sm cursor-pointer ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                <input
                  type="checkbox"
                  checked={multiLine}
                  onChange={(e) => {
                    setSavedConfig(null);
                    if (activeField === 'facility_name') setFnMultiLine(e.target.checked);
                    else setPdMultiLine(e.target.checked);
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Multi-line field
              </label>
              <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {activeField === 'facility_name'
                  ? 'Enable if facility names can wrap to a second line'
                  : 'Enable if the PE stamp date may span multiple lines'
                }
              </span>
            </div>
          )}

          {/* PDF canvas with overlay */}
          <div ref={containerRef} className={`relative rounded-lg overflow-hidden border ${darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-gray-100'}`}>
            <div className="relative inline-block" style={{ margin: '20px auto', display: 'block', width: canvasSize.width || 'auto' }}>
              <canvas ref={canvasRef} className="block" />
              <canvas
                ref={overlayRef}
                className="absolute top-0 left-0 cursor-crosshair"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { if (drawing) handleMouseUp(); }}
              />
            </div>
          </div>

          {/* Extracted text preview */}
          {(anchorText || valueText) && (
            <div className={`rounded-lg border p-4 space-y-3 ${darkMode ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-gray-50'}`}>
              <p className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Extraction Preview — {activeField === 'facility_name' ? 'Facility Name' : 'PE Stamp Date'}
              </p>
              {anchorText && (
                <div>
                  <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Anchor text:</span>
                  <p className={`text-sm mt-0.5 font-mono ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    &ldquo;{anchorText}&rdquo;
                  </p>
                </div>
              )}
              {valueText && (
                <div>
                  <span className={`text-xs font-medium ${activeField === 'facility_name'
                    ? (darkMode ? 'text-blue-400' : 'text-blue-600')
                    : (darkMode ? 'text-green-400' : 'text-green-600')
                    }`}>
                    Extracted value:
                  </span>
                  <p className={`text-sm mt-0.5 font-mono ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {valueText || <span className="italic text-gray-400">No text found in region</span>}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !canSave}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${savedConfig
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
            >
              {savedConfig ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : savedConfig ? 'Saved' : 'Save Extraction Config'}
            </button>
            {!canSave && (
              <p className={`text-xs ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
                {!fnComplete && !pdComplete
                  ? 'Define anchor + value regions for both fields'
                  : !fnComplete
                    ? 'Define anchor + value regions for Facility Name'
                    : 'Define anchor + value regions for PE Stamp Date'
                }
              </p>
            )}
          </div>
        </div>
      )}

      {/* Hidden file input for "Use Different PDF" from configure step */}
      {step === 'configure' && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) loadPdf(e.target.files[0]);
          }}
        />
      )}
    </div>
  );
}
