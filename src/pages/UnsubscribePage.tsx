import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, XCircle, Mail, Settings } from 'lucide-react';

export default function UnsubscribePage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'already'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setMessage('Invalid unsubscribe link. The token is missing.');
      return;
    }

    const unsubscribe = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/handle-unsubscribe?token=${token}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        const data = await response.json();

        if (response.ok) {
          if (data.alreadyUnsubscribed) {
            setStatus('already');
            setMessage('You have already unsubscribed from email notifications.');
          } else {
            setStatus('success');
            setMessage('You have been successfully unsubscribed from email notifications.');
          }
        } else {
          setStatus('error');
          setMessage(data.error || 'Failed to unsubscribe. Please try again.');
        }
      } catch (error) {
        console.error('Unsubscribe error:', error);
        setStatus('error');
        setMessage('An unexpected error occurred. Please try again later.');
      }
    };

    unsubscribe();
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {status === 'loading' && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Processing...</h2>
            <p className="text-gray-600">Please wait while we process your request.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Unsubscribed Successfully</h2>
            <p className="text-gray-600 mb-6">{message}</p>

            <div className="bg-blue-50 rounded-lg p-4 mb-6 text-left">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                <Mail className="w-4 h-4" />
                What this means:
              </h3>
              <ul className="text-sm text-gray-600 space-y-1 ml-6 list-disc">
                <li>You will no longer receive team invitation emails</li>
                <li>You will not receive compliance notification emails</li>
                <li>You will not receive any automated emails from Survey-Route</li>
              </ul>
            </div>

            <div className="space-y-3">
              <Link
                to="/login"
                className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Manage Preferences in Settings
              </Link>
              <p className="text-sm text-gray-500">
                You can re-enable email notifications anytime in your account settings.
              </p>
            </div>
          </div>
        )}

        {status === 'already' && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <Mail className="w-10 h-10 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Already Unsubscribed</h2>
            <p className="text-gray-600 mb-6">{message}</p>

            <div className="space-y-3">
              <Link
                to="/login"
                className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Manage Preferences in Settings
              </Link>
              <p className="text-sm text-gray-500">
                Want to receive emails again? You can re-enable notifications in your account settings.
              </p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
              <XCircle className="w-10 h-10 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Unsubscribe Failed</h2>
            <p className="text-gray-600 mb-6">{message}</p>

            <div className="space-y-3">
              <button
                onClick={() => window.location.reload()}
                className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Try Again
              </button>
              <Link
                to="/login"
                className="block w-full py-3 px-4 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition-colors"
              >
                Go to Login
              </Link>
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="text-center">
            <h3 className="font-semibold text-gray-900 mb-2">Survey-Route</h3>
            <p className="text-sm text-gray-500">
              Professional Facility Inspection Management
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
