import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Download, AlertTriangle, Loader, Shield } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface PlanInfo {
  facility_name: string;
  plan_url: string;
  pe_stamp_date: string | null;
  company_name: string | null;
}

export default function SPCCPlanViewerPage() {
  const { facilityId } = useParams<{ facilityId: string }>();
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!facilityId) {
      setError('No facility specified.');
      setLoading(false);
      return;
    }

    const loadPlan = async () => {
      try {
        const { data, error: rpcError } = await supabase
          .rpc('get_spcc_plan_public', { p_facility_id: facilityId });

        if (rpcError) throw rpcError;

        if (!data || data.length === 0) {
          setError('SPCC Plan not found or not yet uploaded for this facility.');
          return;
        }

        setPlanInfo(data[0]);
      } catch (err: any) {
        console.error('Error loading SPCC plan:', err);
        setError('Unable to load SPCC plan. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    loadPlan();
  }, [facilityId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-10 h-10 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading SPCC Plan...</p>
        </div>
      </div>
    );
  }

  if (error || !planInfo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Plan Not Available</h1>
          <p className="text-gray-600">{error || 'This SPCC plan could not be found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header bar */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-100 rounded-lg shrink-0">
              <Shield className="w-5 h-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold text-gray-900 truncate">
                {planInfo.facility_name}
              </h1>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {planInfo.company_name && (
                  <span>{planInfo.company_name}</span>
                )}
                {planInfo.pe_stamp_date && (
                  <span>PE Stamp: {new Date(planInfo.pe_stamp_date).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          </div>

          <a
            href={planInfo.plan_url}
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shrink-0"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Download</span>
          </a>
        </div>
      </header>

      {/* PDF Viewer */}
      <div className="flex-1 flex flex-col">
        {/* Embedded PDF - uses object tag with iframe fallback for broad compatibility */}
        <object
          data={planInfo.plan_url}
          type="application/pdf"
          className="flex-1 w-full min-h-[calc(100vh-64px)]"
        >
          {/* Fallback for browsers/devices that don't support inline PDF */}
          <div className="flex items-center justify-center p-8 min-h-[60vh]">
            <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
              <FileText className="w-16 h-16 text-blue-500 mx-auto mb-4" />
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                SPCC Plan — {planInfo.facility_name}
              </h2>
              {planInfo.pe_stamp_date && (
                <p className="text-sm text-gray-500 mb-4">
                  PE Stamp Date: {new Date(planInfo.pe_stamp_date).toLocaleDateString()}
                </p>
              )}
              <p className="text-gray-600 mb-6">
                Your device doesn't support inline PDF viewing. Tap below to open the plan.
              </p>
              <a
                href={planInfo.plan_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <FileText className="w-5 h-5" />
                Open SPCC Plan
              </a>
            </div>
          </div>
        </object>
      </div>
    </div>
  );
}
