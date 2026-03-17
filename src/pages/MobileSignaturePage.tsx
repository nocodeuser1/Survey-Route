import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Save, MapPin, CheckCircle, AlertTriangle, Trash2, RotateCw } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';

type PageState = 'loading' | 'ready' | 'saving' | 'success' | 'expired' | 'error';

export default function MobileSignaturePage() {
  const { token } = useParams<{ token: string }>();
  const sigCanvas = useRef<SignatureCanvas>(null);

  const [state, setState] = useState<PageState>('loading');
  const [fullName, setFullName] = useState('');
  const [userId, setUserId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  const [isLandscape, setIsLandscape] = useState(false);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setState('expired');
      return;
    }

    const validateToken = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('signature_tokens')
          .select('*')
          .eq('token', token)
          .is('used_at', null)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (!data) {
          setState('expired');
          return;
        }

        setFullName(data.full_name);
        setUserId(data.user_id);
        setAccountId(data.account_id);
        setState('ready');
      } catch (err: any) {
        console.error('Token validation error:', err);
        setError(err.message || 'Failed to validate link');
        setState('error');
      }
    };

    validateToken();
  }, [token]);

  // Orientation detection
  useEffect(() => {
    const checkOrientation = () => {
      setIsLandscape(window.matchMedia('(orientation: landscape)').matches);
    };
    checkOrientation();
    const mq = window.matchMedia('(orientation: landscape)');
    mq.addEventListener('change', checkOrientation);
    return () => mq.removeEventListener('change', checkOrientation);
  }, []);

  const handleClear = () => {
    sigCanvas.current?.clear();
  };

  const handleSave = async () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      setError('Please draw your signature');
      return;
    }

    setState('saving');
    setError('');

    try {
      const signatureData = sigCanvas.current.toDataURL();

      // Insert signature using anon access (RLS policy allows this)
      const { error: sigError } = await supabase
        .from('user_signatures')
        .insert({
          user_id: userId,
          account_id: accountId,
          signature_name: fullName,
          signature_data: signatureData,
        });

      if (sigError) throw sigError;

      // Mark token as used
      await supabase
        .from('signature_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('token', token!);

      setState('success');
    } catch (err: any) {
      console.error('Error saving signature:', err);
      setError(err.message || 'Failed to save signature');
      setState('ready');
    }
  };

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Validating link...</p>
        </div>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center">
          <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h2>
          <p className="text-gray-600 mb-4">
            This signature link has expired or has already been used. Please generate a new QR code from your desktop.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Signature Saved!</h2>
          <p className="text-gray-600 mb-2">
            Your signature has been added successfully.
          </p>
          <p className="text-sm text-gray-500">
            You can close this tab and return to your desktop. The page will automatically update.
          </p>
        </div>
      </div>
    );
  }

  // Landscape fullscreen mode
  if (isLandscape) {
    return (
      <div className="fixed inset-0 bg-white flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-green-600" />
            <span className="font-semibold text-gray-900">Sign as: {fullName}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleSave}
              disabled={state === 'saving'}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {state === 'saving' ? 'Saving...' : 'Save Signature'}
            </button>
          </div>
        </div>
        {error && (
          <div className="px-4 py-2 bg-red-50 text-red-700 text-sm">{error}</div>
        )}
        <div className="flex-1 border-2 border-gray-200">
          <SignatureCanvas
            ref={sigCanvas}
            canvasProps={{ className: 'w-full h-full touch-action-none' }}
          />
        </div>
      </div>
    );
  }

  // Portrait mode
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-lg w-full p-6">
        <div className="flex items-center justify-center gap-2 mb-4">
          <MapPin className="w-8 h-8 text-green-600" />
          <span className="text-2xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
            Survey Route
          </span>
        </div>

        <h2 className="text-xl font-bold text-gray-900 text-center mb-1">
          Add Your Signature
        </h2>
        <p className="text-gray-500 text-center text-sm mb-6">
          Signing as <strong>{fullName}</strong>
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Landscape tip */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <RotateCw className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>Rotate your phone for a larger signing area</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Draw your signature below
          </label>
          <div className="border-2 border-gray-300 rounded-lg bg-white overflow-hidden">
            <SignatureCanvas
              ref={sigCanvas}
              canvasProps={{ className: 'w-full h-48 touch-action-none' }}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleClear}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
          <button
            onClick={handleSave}
            disabled={state === 'saving'}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
          >
            <Save className="w-4 h-4" />
            {state === 'saving' ? 'Saving...' : 'Save Signature'}
          </button>
        </div>
      </div>
    </div>
  );
}
