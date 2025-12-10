import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PenTool, Save, Trash2, CheckCircle, Smartphone, RotateCw, Clock, Shield, MapPin } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
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
                {/* Mobile tip for desktop users */}
                {!isMobile && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Smartphone className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-green-900 mb-1">
                          Prefer to sign on mobile?
                        </p>
                        <p className="text-sm text-green-800">
                          Signatures are easier to add on mobile devices. Click "Add Later" below, then log in at <strong>survey-root.com</strong> on your mobile device to add your signature with touch input.
                        </p>
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
                          ? "You can add your signature now or click 'Add Later' to access the app and add it from your mobile device. You can update your signature anytime from the settings page."
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
    </div>
  );
}
