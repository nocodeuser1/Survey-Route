import { useState, useRef, useEffect } from 'react';
import { Save, Trash2, Edit, Smartphone } from 'lucide-react';
import { supabase, TeamSignature } from '../lib/supabase';
import SignatureCanvas from 'react-signature-canvas';
import { useDarkMode } from '../contexts/DarkModeContext';
import { autocropSignature } from '../utils/signatureAutocrop';

interface SignatureSetupProps {
  userId: string;
  teamNumber: number;
  onSaved?: () => void;
  accountId: string;
  isOwnerOrAdmin?: boolean;
}

export default function SignatureSetup({ userId, teamNumber, onSaved, accountId, isOwnerOrAdmin }: SignatureSetupProps) {
  const { darkMode } = useDarkMode();
  const sigCanvas = useRef<SignatureCanvas>(null);
  const [inspectorName, setInspectorName] = useState('');
  const [existingSignature, setExistingSignature] = useState<TeamSignature | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showFullscreenSignature, setShowFullscreenSignature] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadSignature();
  }, [userId, teamNumber]);

  const loadSignature = async () => {
    try {
      const { data, error } = await supabase
        .from('team_signatures')
        .select('*')
        .eq('account_id', accountId)
        .eq('team_number', teamNumber)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setExistingSignature(data);
        setInspectorName(data.inspector_name);
      } else {
        setIsEditing(true);
      }
    } catch (err) {
      console.error('Error loading signature:', err);
    }
  };

  const handleClear = () => {
    sigCanvas.current?.clear();
  };

  const handleSave = async () => {
    if (!inspectorName.trim()) {
      alert('Please enter inspector name');
      return;
    }

    if (sigCanvas.current?.isEmpty()) {
      alert('Please provide a signature');
      return;
    }

    setIsSaving(true);

    try {
      const rawSignatureData = sigCanvas.current?.toDataURL() || '';
      const signatureData = await autocropSignature(rawSignatureData);

      if (existingSignature) {
        const { error } = await supabase
          .from('team_signatures')
          .update({
            inspector_name: inspectorName,
            signature_data: signatureData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingSignature.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('team_signatures').insert({
          account_id: accountId,
          team_number: teamNumber,
          inspector_name: inspectorName,
          signature_data: signatureData,
        });

        if (error) throw error;
      }

      await loadSignature();
      setIsEditing(false);
      setShowFullscreenSignature(false);
      if (onSaved) onSaved();
    } catch (err) {
      console.error('Error saving signature:', err);
      alert('Failed to save signature');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingSignature) return;

    if (!confirm(`Are you sure you want to delete the signature for Team ${teamNumber}?`)) {
      return;
    }

    setIsDeleting(true);

    try {
      const { error } = await supabase
        .from('team_signatures')
        .delete()
        .eq('id', existingSignature.id);

      if (error) throw error;

      setExistingSignature(null);
      setInspectorName('');
      setIsEditing(true);
      if (onSaved) onSaved();
    } catch (err) {
      console.error('Error deleting signature:', err);
      alert('Failed to delete signature');
    } finally {
      setIsDeleting(false);
    }
  };

  const openFullscreenSignature = () => {
    setShowFullscreenSignature(true);
  };

  const closeFullscreenSignature = () => {
    setShowFullscreenSignature(false);
  };

  if (existingSignature && !isEditing) {
    return (
      <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors duration-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 dark:text-white">Team {teamNumber} Signature</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              <Edit className="w-4 h-4" />
              Edit
            </button>
            {isOwnerOrAdmin && (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-200 mb-2">
          <span className="font-medium">Inspector:</span> {existingSignature.inspector_name}
        </p>
        <div>
          <img
            src={existingSignature.signature_data}
            alt="Signature"
            className="max-w-full h-auto"
            style={{ maxHeight: '100px' }}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg transition-colors duration-200">
        <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Team {teamNumber} Signature Setup</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Inspector Name
            </label>
            <input
              type="text"
              value={inspectorName}
              onChange={(e) => setInspectorName(e.target.value)}
              placeholder="Enter inspector name"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Signature
            </label>

            {/* Mobile: Button to open fullscreen */}
            <button
              onClick={openFullscreenSignature}
              className="md:hidden w-full flex items-center justify-center gap-2 px-4 py-8 bg-white dark:bg-gray-700 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <Smartphone className="w-6 h-6 text-gray-400" />
              <span className="text-gray-600 dark:text-gray-300 font-medium">Tap to Sign</span>
            </button>

            {/* Desktop: Inline signature canvas */}
            <div className="hidden md:block border-2 border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 transition-colors duration-200">
              <SignatureCanvas
                ref={sigCanvas}
                penColor={darkMode ? '#ffffff' : '#000000'}
                canvasProps={{
                  className: 'w-full h-32 touch-action-none',
                }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 hidden md:block">
              Draw your signature with your mouse
            </p>
          </div>

          <div className="hidden md:flex gap-2">
            <button
              onClick={handleClear}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>

          {existingSignature && (
            <button
              onClick={() => setIsEditing(false)}
              className="w-full px-4 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-white"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Fullscreen Landscape Signature Modal (Mobile Only) */}
      {showFullscreenSignature && (
        <div className="fixed inset-0 bg-white dark:bg-gray-900 z-[80] flex flex-col md:hidden landscape-signature-container transition-colors duration-200">
          <style>{`
            .landscape-signature-container {
              width: 100vw;
              height: 100vh;
              overflow: hidden;
            }

            @media (max-width: 768px) {
              .landscape-signature-container {
                transform-origin: center center;
              }
            }
          `}</style>

          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Sign Here</h2>
                <p className="text-xs text-blue-100 mt-1">
                  Team {teamNumber} - Rotate device to landscape for best experience
                </p>
              </div>
            </div>
          </div>

          {/* Inspector Name Input */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800 flex-shrink-0 transition-colors duration-200">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Inspector Name
            </label>
            <input
              type="text"
              value={inspectorName}
              onChange={(e) => setInspectorName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
            />
          </div>

          {/* Signature Canvas - Takes remaining space */}
          <div className="flex-1 bg-white dark:bg-gray-700 border-y-2 border-gray-300 dark:border-gray-600 relative overflow-hidden transition-colors duration-200">
            <SignatureCanvas
              ref={sigCanvas}
              penColor={darkMode ? '#ffffff' : '#000000'}
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
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-medium"
              >
                <Save className="w-5 h-5" />
                {isSaving ? 'Saving...' : 'Submit'}
              </button>
            </div>
            <button
              onClick={closeFullscreenSignature}
              className="w-full px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
