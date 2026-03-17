import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Save, MapPin, CheckCircle, AlertTriangle, Trash2, Monitor, LogIn, Sparkles } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';

type PageState = 'loading' | 'ready' | 'saving' | 'success' | 'expired' | 'error';

export default function MobileSignaturePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const sigCanvas = useRef<SignatureCanvas>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const savedData = useRef<object[]>([]);

  const [state, setState] = useState<PageState>('loading');
  const [fullName, setFullName] = useState('');
  const [userId, setUserId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');

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

  // Fit canvas pixel dimensions to wrapper div
  const fitCanvas = useCallback(() => {
    const sc = sigCanvas.current;
    const wrap = wrapperRef.current;
    if (!sc || !wrap) return;

    // Save strokes
    const d = sc.toData();
    if (d && d.length) savedData.current = d;

    const canvas = sc.getCanvas();
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    // Restore strokes
    if (savedData.current.length) sc.fromData(savedData.current as any);
  }, []);

  // Resize on mount + orientation change
  useEffect(() => {
    if (state !== 'ready' && state !== 'saving') return;

    const run = () => {
      fitCanvas();
      setTimeout(fitCanvas, 200);
      setTimeout(fitCanvas, 500);
    };
    // initial
    setTimeout(run, 100);

    window.addEventListener('resize', run);
    window.addEventListener('orientationchange', () => setTimeout(run, 400));
    return () => window.removeEventListener('resize', run);
  }, [state, fitCanvas]);

  const handleClear = () => { sigCanvas.current?.clear(); savedData.current = []; };

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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f9ff' }}>
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fef2f2' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 400, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <AlertTriangle style={{ width: 64, height: 64, color: '#f59e0b', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 8 }}>Link Expired</h2>
          <p style={{ color: '#6b7280' }}>This link has expired or been used. Please generate a new QR code from your desktop.</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fef2f2' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 400, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <AlertTriangle style={{ width: 64, height: 64, color: '#ef4444', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#6b7280' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'linear-gradient(135deg, #f0fdf4, #fff, #eff6ff)' }}>
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
            <MapPin style={{ width: 16, height: 16, color: '#16a34a' }} />
            <span style={{ fontSize: 14, fontWeight: 600, background: 'linear-gradient(90deg, #16a34a, #2563eb)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Survey Route</span>
            <Sparkles style={{ width: 12, height: 12, color: '#f59e0b' }} />
          </div>
        </div>
      </div>
    );
  }

  // ====== SIGNING VIEW ======
  // Simple full-viewport layout. Canvas fills all available space.
  // Works in both portrait and landscape without re-mounting.
  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#f9fafb',
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        overflow: 'hidden',
      } as React.CSSProperties}
    >
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapPin style={{ width: 18, height: 18, color: '#16a34a' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{fullName}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleClear}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '6px 12px', background: '#fff',
              border: '1px solid #d1d5db', borderRadius: 6,
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
              padding: '6px 14px', background: '#2563eb',
              border: 'none', borderRadius: 6,
              fontSize: 13, fontWeight: 600, color: '#fff',
              cursor: 'pointer',
              opacity: state === 'saving' ? 0.5 : 1,
            }}
          >
            <Save style={{ width: 14, height: 14 }} />
            {state === 'saving' ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#dc2626', fontSize: 13, borderBottom: '1px solid #fecaca', flexShrink: 0 }}>
          {error}
        </div>
      )}

      {/* Canvas area - fills remaining space */}
      <div
        ref={wrapperRef}
        style={{
          flex: 1,
          position: 'relative',
          background: '#fff',
          touchAction: 'none',
          minHeight: 0, /* important for flex children */
        }}
      >
        <SignatureCanvas
          ref={sigCanvas}
          penColor="#1a1a2e"
          minWidth={1.5}
          maxWidth={3.5}
          velocityFilterWeight={0.7}
          canvasProps={{
            style: {
              position: 'absolute',
              top: 0, left: 0,
              touchAction: 'none',
              WebkitTouchCallout: 'none',
              WebkitUserSelect: 'none',
            } as React.CSSProperties,
          }}
        />

        {/* Sign-here line */}
        <div style={{ position: 'absolute', left: 24, right: 24, bottom: 32, pointerEvents: 'none' }}>
          <div style={{ borderBottom: '1.5px dashed #d1d5db' }} />
          <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 4 }}>Sign above this line</p>
        </div>
      </div>
    </div>
  );
}
