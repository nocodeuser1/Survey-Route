import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Save, MapPin, CheckCircle, AlertTriangle, Trash2, Monitor, LogIn, Sparkles, Route, RotateCcw } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';

type PageState = 'loading' | 'ready' | 'saving' | 'success' | 'expired' | 'error';

// Height of the top toolbar in px
const BAR_H = 64;

export default function MobileSignaturePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const sigCanvas = useRef<SignatureCanvas>(null);
  const savedData = useRef<object[]>([]);

  const [state, setState] = useState<PageState>('loading');
  const [fullName, setFullName] = useState('');
  const [userId, setUserId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  const [viewH, setViewH] = useState(window.innerHeight);
  const [isPortrait, setIsPortrait] = useState(window.innerHeight > window.innerWidth);

  // Validate token
  useEffect(() => {
    if (!token) { setState('expired'); return; }
    (async () => {
      try {
        const { data, error: e } = await supabase
          .from('signature_tokens')
          .select('*')
          .eq('token', token)
          .is('used_at', null)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();
        if (e) throw e;
        if (!data) { setState('expired'); return; }
        setFullName(data.full_name);
        setUserId(data.user_id);
        setAccountId(data.account_id);
        setState('ready');
      } catch (err: any) {
        setError(err.message || 'Failed to validate link');
        setState('error');
      }
    })();
  }, [token]);

  // Track actual viewport height (handles iOS address bar)
  useEffect(() => {
    const update = () => {
      setViewH(window.innerHeight);
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', () => setTimeout(update, 300));
    // visualViewport is more accurate on iOS
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  // Resize canvas to fill its container using actual pixel measurements
  const fitCanvas = useCallback(() => {
    const sc = sigCanvas.current;
    if (!sc) return;

    // Save existing strokes
    const d = sc.toData();
    if (d && d.length) savedData.current = d;

    const canvas = sc.getCanvas();
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    const w = window.innerWidth;
    const h = viewH - BAR_H;
    if (w < 1 || h < 1) return;

    // Set physical pixel size
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    // Set display size
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      // Fill white background
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }

    // Restore strokes
    if (savedData.current.length) sc.fromData(savedData.current as any);
  }, [viewH]);

  // Run fitCanvas when ready and on viewport changes
  useEffect(() => {
    if (state !== 'ready' && state !== 'saving') return;
    // Multiple passes for Safari timing
    fitCanvas();
    const t1 = setTimeout(fitCanvas, 100);
    const t2 = setTimeout(fitCanvas, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [state, fitCanvas, viewH]);

  const handleClear = () => {
    sigCanvas.current?.clear();
    savedData.current = [];
    // Re-fill white background after clear
    const sc = sigCanvas.current;
    if (sc) {
      const canvas = sc.getCanvas();
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }
  };

  const handleSave = async () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      setError('Please draw your signature'); return;
    }
    setState('saving');
    setError('');
    try {
      const sig = sigCanvas.current.toDataURL();
      const { error: e } = await supabase.from('user_signatures').insert({
        user_id: userId, account_id: accountId,
        signature_name: fullName, signature_data: sig,
      });
      if (e) throw e;
      await supabase.from('signature_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', token!);
      setState('success');
    } catch (err: any) {
      setError(err.message || 'Failed to save');
      setState('ready');
    }
  };

  // ---- Status screens ----
  if (state === 'loading') {
    return (
      <div style={centerScreen}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, border: '3px solid #2563eb', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 16, color: '#6b7280' }}>Validating link...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div style={centerScreen}>
        <div style={cardStyle}>
          <AlertTriangle style={{ width: 64, height: 64, color: '#f59e0b', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 8 }}>Link Expired</h2>
          <p style={{ color: '#6b7280' }}>This link has expired or been used. Please generate a new QR code from your desktop.</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={centerScreen}>
        <div style={cardStyle}>
          <AlertTriangle style={{ width: 64, height: 64, color: '#ef4444', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#6b7280' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div style={{ ...centerScreen, flexDirection: 'column' as const }}>
        <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}>
          <div style={{ background: 'linear-gradient(135deg, #22c55e, #10b981)', padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ width: 80, height: 80, background: 'rgba(255,255,255,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <CheckCircle style={{ width: 48, height: 48, color: '#fff' }} />
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Signature Saved!</h2>
            <p style={{ color: '#bbf7d0', fontSize: 14 }}>Your signature has been added to your account</p>
          </div>
          <div style={{ padding: 24 }}>
            <div style={{ background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Monitor style={{ width: 20, height: 20, color: '#2563eb', flexShrink: 0, marginTop: 2 }} />
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#1e3a5f', marginBottom: 4 }}>Back on desktop?</p>
                  <p style={{ fontSize: 14, color: '#3b82f6' }}>Your desktop session will automatically detect your signature and proceed. Just switch back!</p>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
              <span style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>or</span>
              <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
            </div>
            <button
              onClick={() => navigate('/login')}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 16px', background: 'linear-gradient(135deg, #2563eb, #4f46e5)', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}
            >
              <LogIn style={{ width: 20, height: 20 }} />
              Sign In on This Device
            </button>
            <p style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>Access your full Survey Route account from your phone</p>
          </div>
          <div style={{ borderTop: '1px solid #f3f4f6', padding: '16px 24px', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div className="bg-blue-600 p-1 rounded-md">
              <Route style={{ width: 14, height: 14, color: '#fff' }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Survey Route</span>
            <Sparkles style={{ width: 12, height: 12, color: '#f59e0b' }} />
          </div>
        </div>
      </div>
    );
  }

  // ====== SIGNING VIEW ======
  // No flexbox. No position:fixed. Pure pixel math.
  // Top bar = BAR_H px. Canvas = rest of viewport.
  const canvasH = viewH - BAR_H;

  return (
    <>
      {/* Kill all scroll/bounce on this page */}
      <style>{`
        html, body, #root { 
          margin: 0; padding: 0; overflow: hidden; 
          height: ${viewH}px; width: 100vw;
          touch-action: none;
          -webkit-overflow-scrolling: auto;
        }
      `}</style>

      {/* Top bar */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: BAR_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        paddingTop: 'max(0px, env(safe-area-inset-top))',
        background: '#fff',
        borderBottom: '2px solid #2563eb',
        zIndex: 10,
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="bg-blue-600 p-2 rounded-lg">
            <Route className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-gray-900 leading-tight">Survey-Route</span>
            <span className="text-[10px] text-gray-500 font-medium">by BEAR DATA</span>
          </div>
        </div>

        <div className="hidden sm:flex flex-col items-center">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Signing As</span>
          <span className="text-sm font-bold text-blue-600">{fullName}</span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleClear}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '8px 12px', background: '#fff',
              border: '1px solid #d1d5db', borderRadius: 8,
              fontSize: 13, fontWeight: 500, color: '#374151',
              cursor: 'pointer',
            }}
          >
            <Trash2 style={{ width: 14, height: 14 }} />
            Clear
          </button>
          <button
            onClick={handleSave}
            disabled={state === 'saving'}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '8px 14px', background: '#2563eb',
              border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 600, color: '#fff',
              opacity: state === 'saving' ? 0.5 : 1,
              cursor: 'pointer',
            }}
          >
            <Save style={{ width: 14, height: 14 }} />
            {state === 'saving' ? 'Save' : 'Save'}
          </button>
        </div>
      </div>

      {/* Portrait Prompt overlay */}
      {isPortrait && state === 'ready' && (
        <div style={{
          position: 'absolute',
          top: BAR_H + 8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          pointerEvents: 'none',
        }}>
          <div className="bg-blue-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-bounce">
            <RotateCcw className="w-4 h-4" />
            <span className="text-xs font-bold whitespace-nowrap uppercase tracking-wide">Rotate for larger area</span>
          </div>
        </div>
      )}

      {/* Error bar (if any) */}
      {error && (
        <div style={{
          position: 'absolute',
          top: BAR_H, left: 0, right: 0,
          padding: '8px 12px', background: '#fef2f2', color: '#dc2626',
          fontSize: 13, zIndex: 10,
        }}>
          {error}
        </div>
      )}

      {/* Canvas - positioned absolutely below the bar */}
      <div style={{
        position: 'absolute',
        top: BAR_H,
        left: 0,
        width: '100vw',
        height: canvasH,
        overflow: 'hidden',
        background: '#fff',
      }}>
        <SignatureCanvas
          ref={sigCanvas}
          penColor="#111827"
          minWidth={1.5}
          maxWidth={3.5}
          velocityFilterWeight={0.7}
          clearOnResize={false}
          backgroundColor="#ffffff"
          canvasProps={{
            width: window.innerWidth,
            height: canvasH,
            style: {
              display: 'block',
              touchAction: 'none',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
              userSelect: 'none',
            } as React.CSSProperties,
          }}
        />

        {/* Sign-here guide */}
        <div style={{
          position: 'absolute', left: 24, right: 24, bottom: 48,
          pointerEvents: 'none', zIndex: 5,
        }}>
          <div style={{ borderBottom: '2px solid #e5e7eb' }} />
          <div className="flex justify-between items-center mt-2">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Sign Above</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-blue-500 font-bold tracking-tight">{fullName}</span>
              <Sparkles className="w-2 h-2 text-yellow-500" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const centerScreen: React.CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'linear-gradient(135deg, #f0f9ff 0%, #fff 50%, #f0fdf4 100%)',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: 32,
  maxWidth: 400,
  width: '100%',
  textAlign: 'center',
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};


const centerScreen: React.CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'linear-gradient(135deg, #f0f9ff 0%, #fff 50%, #f0fdf4 100%)',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: 32,
  maxWidth: 400,
  width: '100%',
  textAlign: 'center',
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};
