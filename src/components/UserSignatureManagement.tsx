import { useState, useRef, useEffect } from 'react';
import { PenTool, Save, Trash2, Edit, CheckCircle, UserCog, X, Shield, RotateCw, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import SignatureCanvas from 'react-signature-canvas';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';
import { useDarkMode } from '../contexts/DarkModeContext';
import { autocropSignature } from '../utils/signatureAutocrop';

export default function UserSignatureManagement() {
  const { user, reloadUserProfile } = useAuth();
  const { currentAccount } = useAccount();
  const { darkMode } = useDarkMode();
  const sigCanvas = useRef<SignatureCanvas>(null);

  const [signature, setSignature] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  const [showFullscreenSignature, setShowFullscreenSignature] = useState(false);

  // Agency owner features
  const [allSignatures, setAllSignatures] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [reassignModal, setReassignModal] = useState<{signatureId: string; currentUserId: string; currentUserName: string} | null>(null);
  const [reassigning, setReassigning] = useState(false);

  useEffect(() => {
    if (user && currentAccount) {
      loadSignature();
      if (user.isAgencyOwner) {
        loadAllSignatures();
        loadAllUsers();
      }
    }
  }, [user, currentAccount]);

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

  async function loadSignature() {
    if (!user || !currentAccount) return;

    try {
      setLoading(true);

      const { data: userProfile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', user.authUserId)
        .maybeSingle();

      if (!userProfile) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_signatures')
        .select('*')
        .eq('user_id', userProfile.id)
        .eq('account_id', currentAccount.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setSignature(data);
      } else {
        setEditing(true);
      }
    } catch (err: any) {
      console.error('Error loading signature:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAllSignatures() {
    if (!user?.isAgencyOwner || !currentAccount) return;

    try {
      const { data, error } = await supabase
        .from('user_signatures')
        .select(`
          *,
          users:user_id (
            id,
            full_name,
            email
          )
        `)
        .eq('account_id', currentAccount.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAllSignatures(data || []);
    } catch (err: any) {
      console.error('Error loading all signatures:', err);
    }
  }

  async function loadAllUsers() {
    if (!user?.isAgencyOwner || !currentAccount) return;

    try {
      const { data, error } = await supabase
        .from('account_users')
        .select(`
          user_id,
          role,
          users:user_id (
            id,
            full_name,
            email
          )
        `)
        .eq('account_id', currentAccount.id);

      if (error) throw error;
      setAllUsers(data || []);
    } catch (err: any) {
      console.error('Error loading all users:', err);
    }
  }

  async function handleReassignSignature(newUserId: string) {
    if (!reassignModal || !user?.isAgencyOwner) return;

    setReassigning(true);
    setError('');
    setSuccess('');

    try {
      const { error } = await supabase
        .from('user_signatures')
        .update({
          user_id: newUserId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reassignModal.signatureId);

      if (error) throw error;

      setSuccess('Signature reassigned successfully');
      setReassignModal(null);
      await loadAllSignatures();

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Error reassigning signature:', err);
      setError(err.message || 'Failed to reassign signature');
    } finally {
      setReassigning(false);
    }
  }

  const handleClear = () => {
    sigCanvas.current?.clear();
  };

  const handleEdit = () => {
    setEditing(true);
    setError('');
    setSuccess('');
    // On mobile, open fullscreen immediately
    if (isMobile) {
      setShowFullscreenSignature(true);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setShowFullscreenSignature(false);
    if (sigCanvas.current) {
      sigCanvas.current.clear();
    }
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    if (!user || !currentAccount) return;

    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      setError('Please provide your signature');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const rawSignatureData = sigCanvas.current.toDataURL();
      const signatureData = await autocropSignature(rawSignatureData);

      const { data: userProfile } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('auth_user_id', user.authUserId)
        .maybeSingle();

      if (!userProfile) throw new Error('User profile not found');

      if (signature) {
        const { error: updateError } = await supabase
          .from('user_signatures')
          .update({
            signature_data: signatureData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', signature.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('user_signatures')
          .insert({
            user_id: userProfile.id,
            account_id: currentAccount.id,
            signature_name: userProfile.full_name || user.fullName || 'User',
            signature_data: signatureData,
          });

        if (insertError) throw insertError;
      }

      await loadSignature();
      setEditing(false);
      setShowFullscreenSignature(false);
      setSuccess('Signature saved successfully');

      // Reload user profile to update signature_completed status
      await reloadUserProfile();

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Error saving signature:', err);
      setError(err.message || 'Failed to save signature');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-2 text-gray-600">Loading signature...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <PenTool className="w-5 h-5" />
            My Signature
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Your signature is used for inspection reports and documentation
          </p>
        </div>
        {!editing && signature && (
          <button
            onClick={handleEdit}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Edit className="w-4 h-4" />
            Edit Signature
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          {success}
        </div>
      )}

      {editing ? (
        <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-6 transition-colors duration-200">
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500 p-4">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-200 mb-1">
                    Your Signature is Private and Secure
                  </p>
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    Only you can use this signature. It will be automatically applied to inspection reports you complete. No other team member can access or use your signature.
                  </p>
                </div>
              </div>
            </div>

            {/* Landscape mode tip for mobile users */}
            {isMobile && !isLandscape && !showFullscreenSignature && (
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <RotateCw className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-200 mb-1">
                      Tip: Rotate for a better signing experience
                    </p>
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      For a larger signing area, the signature field will expand to fill your screen when you rotate to landscape mode.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                Your Name
              </label>
              <input
                type="text"
                value={user?.fullName || ''}
                disabled
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Your name cannot be changed here
              </p>
            </div>

            {!isMobile ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Draw Your Signature
                </label>
                <div className="border-2 border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 overflow-hidden transition-colors duration-200">
                  <SignatureCanvas
                    ref={sigCanvas}
                    penColor={darkMode ? '#ffffff' : '#2563eb'}
                    canvasProps={{
                      className: 'w-full h-48 touch-action-none',
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Draw your signature using your mouse or touchscreen
                </p>
              </div>
            ) : (
              <button
                onClick={() => setShowFullscreenSignature(true)}
                className="w-full flex items-center justify-center gap-3 px-6 py-8 bg-blue-50 dark:bg-blue-900/30 border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              >
                <Smartphone className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                <span className="text-blue-700 dark:text-blue-300 font-medium text-lg">Tap to Add Signature</span>
              </button>
            )}

            {!isMobile && (
              <div className="flex gap-3">
                <button
                  onClick={handleClear}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear
                </button>
                {signature && (
                  <button
                    onClick={handleCancel}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save Signature'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : signature ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
                Your Name
              </label>
              <p className="text-gray-900 dark:text-white font-medium">{signature.signature_name}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-2">
                Your Signature
              </label>
              <div>
                <img
                  src={signature.signature_data}
                  alt="Your signature"
                  className="max-w-full h-auto"
                  style={{
                    maxHeight: '150px',
                    filter: darkMode ? 'invert(1) hue-rotate(180deg)' : 'none'
                  }}
                />
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Last updated: {new Date(signature.updated_at).toLocaleDateString()}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
          <PenTool className="w-12 h-12 text-amber-600 mx-auto mb-3" />
          <p className="text-amber-900 font-medium mb-2">No signature added yet</p>
          <p className="text-amber-800 text-sm">
            Add your signature to complete your profile setup
          </p>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Your signature name is automatically set to your full name and cannot be changed. Your signature will appear on all inspection reports and documentation you create.
        </p>
      </div>

      {user?.isAgencyOwner && allSignatures.length > 0 && (
        <div className="border-t pt-8 mt-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <UserCog className="w-5 h-5" />
                Manage Team Signatures
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                As agency owner, you can reassign signatures to different team members
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {allSignatures.map((sig) => (
              <div key={sig.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-semibold text-gray-900 dark:text-white">
                        {sig.users?.full_name || 'Unknown User'}
                      </h4>
                      <span className="text-sm text-gray-500">
                        ({sig.users?.email})
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div>
                        <img
                          src={sig.signature_data}
                          alt={`Signature of ${sig.signature_name}`}
                          className="max-w-[200px] h-auto border border-gray-200 rounded"
                          style={{
                            maxHeight: '80px',
                            filter: darkMode ? 'invert(1) hue-rotate(180deg)' : 'none'
                          }}
                        />
                      </div>
                      <div className="text-xs text-gray-500">
                        Created: {new Date(sig.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setReassignModal({
                      signatureId: sig.id,
                      currentUserId: sig.user_id,
                      currentUserName: sig.users?.full_name || 'Unknown User'
                    })}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    <UserCog className="w-4 h-4" />
                    Reassign
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen Landscape Signature Modal (Mobile Only) */}
      {showFullscreenSignature && (
        <div className="fixed inset-0 bg-white dark:bg-gray-900 z-[80] flex flex-col transition-colors duration-200">
          {/* Header */}
          <div className="bg-gradient-to-r from-green-600 to-blue-600 text-white p-4 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Add Your Personal Signature</h2>
                <p className="text-xs text-blue-100 mt-1">
                  {isLandscape ? 'Perfect! Sign below' : 'Rotate device to landscape for best experience'}
                </p>
              </div>
            </div>
          </div>

          {/* Privacy Notice */}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/30 flex-shrink-0">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800 dark:text-blue-300">
                This signature is private to you and will only be used on your inspection reports
              </p>
            </div>
          </div>

          {/* Signature Canvas - Takes remaining space */}
          <div className="flex-1 bg-white dark:bg-gray-800 border-y-2 border-gray-300 dark:border-gray-600 relative overflow-hidden transition-colors duration-200">
            <SignatureCanvas
              ref={sigCanvas}
              penColor={darkMode ? '#ffffff' : '#2563eb'}
              canvasProps={{
                className: 'absolute inset-0 w-full h-full touch-action-none',
                style: { width: '100%', height: '100%' }
              }}
            />
            <p className="absolute top-2 left-2 text-xs text-gray-400 dark:text-gray-500 pointer-events-none">
              Sign with your finger
            </p>
          </div>

          {/* Bottom Buttons */}
          <div className="p-4 bg-white dark:bg-gray-800 flex-shrink-0 space-y-2 border-t-2 border-gray-200 dark:border-gray-700 transition-colors duration-200">
            <div className="flex gap-2">
              <button
                onClick={handleClear}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 font-medium"
              >
                <Trash2 className="w-5 h-5" />
                Clear
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-medium"
              >
                <Save className="w-5 h-5" />
                {saving ? 'Saving...' : 'Save Signature'}
              </button>
            </div>
            <button
              onClick={handleCancel}
              className="w-full px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {reassignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Reassign Signature</h3>
              <button
                onClick={() => setReassignModal(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6">
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                Select the team member to receive <strong>{reassignModal.currentUserName}</strong>'s signature.
              </p>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>Warning:</strong> This will transfer the signature to the selected user. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto mb-6">
              {allUsers
                .filter(u => u.user_id !== reassignModal.currentUserId)
                .map((u) => (
                  <button
                    key={u.user_id}
                    onClick={() => handleReassignSignature(u.user_id)}
                    disabled={reassigning}
                    className="w-full text-left px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="font-medium text-gray-900 dark:text-white">
                      {u.users?.full_name}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {u.users?.email} • {u.role === 'account_admin' ? 'Admin' : 'User'}
                    </div>
                  </button>
                ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setReassignModal(null)}
                disabled={reassigning}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
