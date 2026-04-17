import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Save, CheckCircle, MapPin, Shield, Smartphone, RotateCw, Trash2, Clock, QrCode, X } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../contexts/AuthContext';

export default function SignatureSetupPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const sigCanvas = useRef<SignatureCanvas>(null);

  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [accountId, setAccountId] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [generatingQR, setGeneratingQR] = useState(false);
  const [qrPolling, setQrPolling] = useState(false);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    const savedAccountId = localStorage.getItem('currentAccountId');
    const needsSignature = localStorage.getItem('needsSignature');

    if (!savedAccountId || needsSignature !== 'true') {
      navigate('/app', { replace: true });
      return;
    }

    setAccountId(savedAccountId);
    setFullName(user.fullName || '');
    setLoading(false);
  }, [user, authLoading, navigate]);

  // Device and orientation detection
  useEffect(() => {
    const checkDevice = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);
    };

    const checkOrientation = () => {
      const landscape = window.matchMedia('(orientation: landscape)').matches;
      setIsLandscape(landscape);
    };

    checkDevice();
    checkOrientation();

    const orientationQuery = window.matchMedia('(orientation: landscape)');
    const handleOrientationChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsLandscape(e.matches);
    };

    orientationQuery.addEventListener('change', handleOrientationChange);

    return () => {
      orientationQuery.removeEventListener('change', handleOrientationChange);
    };
  }, []);

  const handleClear = () => {
    sigCanvas.current?.clear();
  };

  const handleAddLater = async () => {
    setSaving(true);
    setError('');

    try {
      // Update full name if provided
      if (fullName.trim()) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) throw new Error('Not authenticated');

        const { data: userProfile } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', authUser.id)
          .maybeSingle();

        if (userProfile) {
          await supabase
            .from('users')
            .update({ full_name: fullName.trim() })
            .eq('id', userProfile.id);
        }
      }

      // Mark signature as deferred but allow app access
      localStorage.setItem('signatureDeferred', 'true');
      localStorage.removeItem('needsSignature');

      navigate('/app', { replace: true });
    } catch (err: any) {
      console.error('Error deferring signature:', err);
      setError(err.message || 'Failed to continue');
      setSaving(false);
    }
  };

  const generateQRCode = async () => {
    setGeneratingQR(true);
    setError('');
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('Not authenticated');

      const { data: userProfile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', authUser.id)
        .maybeSingle();

      if (!userProfile) throw new Error('User profile not found');

      // Generate a random token
      const token = crypto.randomUUID() + '-' + crypto.randomUUID().slice(0, 8);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      const { error: insertError } = await supabase
        .from('signature_tokens')
        .insert({
          token,
          user_id: userProfile.id,
          account_id: accountId,
          full_name: fullName.trim() || authUser.email || 'User',
          expires_at: expiresAt.toISOString(),
        });

      if (insertError) throw insertError;

      const url = `${window.location.origin}/mobile-signature/${token}`;
      setQrUrl(url);
      setShowQRCode(true);
      setQrPolling(true);
    } catch (err: any) {
      console.error('Error generating QR code:', err);
      setError(err.message || 'Failed to generate QR code');
    } finally {
      setGeneratingQR(false);
    }
  };

  // Poll for signature completion when QR is shown
  useEffect(() => {
    if (!qrPolling || !user) return;

    const interval = setInterval(async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return;

        const { data: userProfile } = await supabase
          .from('users')
          .select('id')
          .eq('auth_user_id', authUser.id)
          .maybeSingle();

        if (!userProfile) return;

        const { data: sig } = await supabase
          .from('user_signatures')
          .select('id')
          .eq('user_id', userProfile.id)
          .eq('account_id', accountId)
          .maybeSingle();

        if (sig) {
          // Signature was added via mobile!
          setQrPolling(false);
          setShowQRCode(false);
          localStorage.removeItem('needsSignature');
          localStorage.removeItem('signatureDeferred');
          navigate('/app', { replace: true });
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [qrPolling, user, accountId, navigate]);

  const handleSave = async () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      setError('Please provide your signature');
      return;
    }

    if (!fullName.trim()) {
      setError('Please enter your full name');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const signatureData = sigCanvas.current.toDataURL();

      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('Not authenticated');

      const { data: userProfile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', authUser.id)
        .maybeSingle();

      if (!userProfile) throw new Error('User profile not found');

      const { error: updateNameError } = await supabase
        .from('users')
        .update({ full_name: fullName.trim() })
        .eq('id', userProfile.id);

      if (updateNameError) throw updateNameError;

      const { error: signatureError } = await supabase
        .from('user_signatures')
        .insert({
          user_id: userProfile.id,
          account_id: accountId,
          signature_name: fullName.trim(),
          signature_data: signatureData,
        });

      if (signatureError) throw signatureError;

      localStorage.removeItem('needsSignature');
      localStorage.removeItem('signatureDeferred');

      navigate('/app', { replace: true });
    } catch (err: any) {
      console.error('Error saving signature:', err);
      setError(err.message || 'Failed to save signature');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Determine canvas height based on device and orientation
  const canvasHeight = isMobile && isLandscape ? 'h-[70vh]' : 'h-48';
  const containerClass = isMobile && isLandscape ? 'fixed inset-0 z-50 bg-white' : '';
  const contentClass = isMobile && isLandscape ? 'h-full flex flex-col' : '';

  return (
    <div className={`min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center ${isMobile && isLandscape ? 'p-0' : 'p-4'}`}>
      <div className={`bg-white rounded-lg shadow-xl max-w-2xl w-full ${isMobile && isLandscape ? 'max-w-none rounded-none h-full' : 'p-8'} ${containerClass}`}>
        <div className={isMobile && isLandscape ? 'p-4 pb-0' : ''}>
          {!(isMobile && isLandscape) && (
            <>
              <div className="flex items-center justify-center mb-6">
                <div className="flex items-center gap-2">
                  <MapPin className="w-10 h-10 text-green-600" />
                  <div className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
                    Survey Route
                  </div>
                </div>
              </div>

              <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
                Add Your Personal Signature
              </h2>
              <p className="text-gray-600 text-center mb-6">
                This signature is unique to you and will be applied to inspections you complete
              </p>

              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900 mb-1">
                      Your Signature is Private and Secure
                    </p>
                    <p className="text-sm text-blue-800">
                      Only you can use this signature. It will be automatically applied to inspection reports you complete. No other team member can access or use your signature.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className={`space-y-6 ${contentClass}`}>
            {!(isMobile && isLandscape) && (
              <>
                {/* Mobile QR code option for desktop users */}
                {!isMobile && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Smartphone className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-900 mb-1">
                          Prefer to sign on mobile?
                        </p>
                        <p className="text-sm text-green-800 mb-3">
                          Signatures are easier to add on mobile devices. Scan a QR code with your phone to sign directly - no login required.
                        </p>
                        <button
                          onClick={generateQRCode}
                          disabled={generatingQR}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          <QrCode className="w-4 h-4" />
                          {generatingQR ? 'Generating...' : 'Sign on Mobile'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Landscape mode tip for mobile users */}
                {isMobile && !isLandscape && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <RotateCw className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-blue-900 mb-1">
                          Tip: Rotate for a better signing experience
                        </p>
                        <p className="text-sm text-blue-800">
                          For a larger signing area, rotate your device to landscape mode. The signature field will expand to fill your screen.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name {isMobile ? '' : '*'}
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Enter your full name"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    This will be displayed with your signature on all documents
                  </p>
                </div>
              </>
            )}

            <div className={isMobile && isLandscape ? 'flex-1 flex flex-col' : ''}>
              {!(isMobile && isLandscape) && (
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your Signature {isMobile ? '' : '*'}
                </label>
              )}
              <div className={`border-2 border-gray-300 rounded-lg bg-white overflow-hidden ${isMobile && isLandscape ? 'flex-1' : ''}`}>
                <SignatureCanvas
                  ref={sigCanvas}
                  canvasProps={{
                    className: `w-full ${canvasHeight} touch-action-none`,
                  }}
                />
              </div>
              {!(isMobile && isLandscape) && (
                <p className="mt-1 text-xs text-gray-500">
                  Draw your signature above using your {isMobile ? 'finger or stylus' : 'mouse or touchscreen'}
                </p>
              )}
            </div>

            <div className={`flex gap-3 ${isMobile && isLandscape ? 'p-4 pt-2' : ''}`}>
              <button
                onClick={handleClear}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save & Continue'}
              </button>
            </div>

            {!(isMobile && isLandscape) && (
              <>
                <button
                  onClick={handleAddLater}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  <Clock className="w-4 h-4" />
                  Add Later
                </button>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-blue-900 mb-1">
                        What happens next?
                      </p>
                      <p className="text-sm text-blue-800">
                        {!isMobile
                          ? "You can add your signature now, scan a QR code to sign on your phone, or click 'Add Later' to come back to it. You can update your signature anytime from the settings page."
                          : "After adding your signature, you'll have full access to the application. You can update your signature anytime from the settings page."
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* QR Code Modal */}
      {showQRCode && qrUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center relative">
            <button
              onClick={() => { setShowQRCode(false); setQrPolling(false); }}
              className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center justify-center gap-2 mb-2">
              <Smartphone className="w-6 h-6 text-green-600" />
              <h3 className="text-xl font-bold text-gray-900">Scan with Your Phone</h3>
            </div>
            <p className="text-sm text-gray-600 mb-6">
              Open your phone's camera and point it at the QR code below. You'll be taken directly to the signature page - no login needed.
            </p>

            <div className="inline-flex p-4 bg-white border-2 border-gray-100 rounded-xl shadow-inner mb-4">
              <QRCodeSVG
                value={qrUrl}
                size={220}
                level="M"
                includeMargin
                bgColor="#ffffff"
                fgColor="#111827"
              />
            </div>

            <div className="flex items-center gap-2 justify-center text-sm text-amber-600 mb-4">
              <Clock className="w-4 h-4" />
              <span>This code expires in 15 minutes</span>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <div className="flex items-center gap-2 justify-center text-sm text-blue-700 font-medium">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                <span>Listening for your signature...</span>
              </div>
              <p className="text-xs text-blue-500 mt-1">
                This page will automatically continue once you sign on your phone
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
