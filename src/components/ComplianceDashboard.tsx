import { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Clock, TrendingUp, FileText, Calendar, Filter, Search, ExternalLink } from 'lucide-react';
import { supabase, Facility, SPCCComplianceTracking } from '../lib/supabase';

interface ComplianceDashboardProps {
  accountId: string;
  userId: string;
  onViewFacility?: (facilityId: string) => void;
}

interface ComplianceStats {
  totalFacilities: number;
  compliantFacilities: number;
  upcomingDue: number;
  overdue: number;
  spccInitialPending: number;
  spccRenewalsDue: number;
  inspectionsDue: number;
}

interface FacilityCompliance {
  facility: Facility;
  spccCompliance?: SPCCComplianceTracking;
  inspectionStatus: 'current' | 'due_soon' | 'overdue' | 'none';
  daysUntilDue?: number;
}

export default function ComplianceDashboard({ accountId, userId, onViewFacility }: ComplianceDashboardProps) {
  const [stats, setStats] = useState<ComplianceStats>({
    totalFacilities: 0,
    compliantFacilities: 0,
    upcomingDue: 0,
    overdue: 0,
    spccInitialPending: 0,
    spccRenewalsDue: 0,
    inspectionsDue: 0,
  });
  const [facilitiesCompliance, setFacilitiesCompliance] = useState<FacilityCompliance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'compliant' | 'upcoming' | 'overdue'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<'overview' | 'spcc' | 'inspections'>('overview');

  useEffect(() => {
    loadDashboardData();
  }, [accountId]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      const { data: facilities, error: facilitiesError } = await supabase
        .from('facilities')
        .select('*')
        .eq('account_id', accountId)
        .order('name');

      if (facilitiesError) throw facilitiesError;

      const { data: spccData, error: spccError } = await supabase
        .from('spcc_compliance_tracking')
        .select('*')
        .eq('account_id', accountId);

      if (spccError) throw spccError;

      const spccMap = new Map(spccData?.map(s => [s.facility_id, s]) || []);

      const facilitiesWithCompliance: FacilityCompliance[] = (facilities || []).map(facility => {
        const spccCompliance = spccMap.get(facility.id);

        let inspectionStatus: 'current' | 'due_soon' | 'overdue' | 'none' = 'none';
        let inspectionDaysUntilDue: number | undefined;

        if (facility.next_inspection_due) {
          const dueDate = new Date(facility.next_inspection_due);
          const today = new Date();
          const diffDays = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          inspectionDaysUntilDue = diffDays;

          if (diffDays < 0) {
            inspectionStatus = 'overdue';
          } else if (diffDays <= 30) {
            inspectionStatus = 'due_soon';
          } else {
            inspectionStatus = 'current';
          }
        }

        return {
          facility,
          spccCompliance,
          inspectionStatus,
          daysUntilDue: spccCompliance?.days_until_due ?? inspectionDaysUntilDue,
        };
      });

      setFacilitiesCompliance(facilitiesWithCompliance);

      const totalFacilities = facilities?.length || 0;
      const compliantFacilities = facilitiesWithCompliance.filter(fc =>
        (fc.spccCompliance?.is_compliant ?? true) && fc.inspectionStatus !== 'overdue'
      ).length;

      const upcomingDue = facilitiesWithCompliance.filter(fc =>
        (fc.spccCompliance?.days_until_due !== null && fc.spccCompliance?.days_until_due! >= 0 && fc.spccCompliance?.days_until_due! <= 30) ||
        fc.inspectionStatus === 'due_soon'
      ).length;

      const overdue = facilitiesWithCompliance.filter(fc =>
        fc.spccCompliance?.compliance_status === 'overdue' || fc.inspectionStatus === 'overdue'
      ).length;

      const spccInitialPending = spccData?.filter(s => s.compliance_status === 'initial_due').length || 0;
      const spccRenewalsDue = spccData?.filter(s => s.compliance_status === 'renewal_due' || s.compliance_status === 'expiring').length || 0;
      const inspectionsDue = facilitiesWithCompliance.filter(fc => fc.inspectionStatus === 'due_soon' || fc.inspectionStatus === 'overdue').length;

      setStats({
        totalFacilities,
        compliantFacilities,
        upcomingDue,
        overdue,
        spccInitialPending,
        spccRenewalsDue,
        inspectionsDue,
      });
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredFacilities = facilitiesCompliance.filter(fc => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!fc.facility.name.toLowerCase().includes(query)) {
        return false;
      }
    }

    if (filter === 'compliant') {
      return (fc.spccCompliance?.is_compliant ?? true) && fc.inspectionStatus !== 'overdue';
    } else if (filter === 'upcoming') {
      return (fc.spccCompliance?.days_until_due !== null && fc.spccCompliance?.days_until_due! >= 0 && fc.spccCompliance?.days_until_due! <= 30) ||
        fc.inspectionStatus === 'due_soon';
    } else if (filter === 'overdue') {
      return fc.spccCompliance?.compliance_status === 'overdue' || fc.inspectionStatus === 'overdue';
    }

    return true;
  });

  const getComplianceStatusBadge = (fc: FacilityCompliance) => {
    if (fc.spccCompliance?.compliance_status === 'overdue' || fc.inspectionStatus === 'overdue') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs font-medium rounded">
          <AlertTriangle className="w-3 h-3" />
          Overdue
        </span>
      );
    } else if (
      (fc.spccCompliance?.days_until_due !== null && fc.spccCompliance?.days_until_due! >= 0 && fc.spccCompliance?.days_until_due! <= 30) ||
      fc.inspectionStatus === 'due_soon'
    ) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 text-xs font-medium rounded">
          <Clock className="w-3 h-3" />
          Due Soon
        </span>
      );
    } else if ((fc.spccCompliance?.is_compliant ?? true) && fc.inspectionStatus !== 'overdue') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-xs font-medium rounded">
          <CheckCircle className="w-3 h-3" />
          Compliant
        </span>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Compliance Dashboard</h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Monitor SPCC plans and inspection schedules across all facilities
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setView('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'overview'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setView('spcc')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'spcc'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            SPCC
          </button>
          <button
            onClick={() => setView('inspections')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'inspections'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Inspections
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Facilities</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-1">
                {stats.totalFacilities}
              </p>
            </div>
            <FileText className="w-10 h-10 text-blue-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Compliant</p>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400 mt-1">
                {stats.compliantFacilities}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {stats.totalFacilities > 0 ? Math.round((stats.compliantFacilities / stats.totalFacilities) * 100) : 0}%
              </p>
            </div>
            <CheckCircle className="w-10 h-10 text-green-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Due Soon</p>
              <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400 mt-1">
                {stats.upcomingDue}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Next 30 days
              </p>
            </div>
            <Clock className="w-10 h-10 text-yellow-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Overdue</p>
              <p className="text-3xl font-bold text-red-600 dark:text-red-400 mt-1">
                {stats.overdue}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Needs attention
              </p>
            </div>
            <AlertTriangle className="w-10 h-10 text-red-500 opacity-20" />
          </div>
        </div>
      </div>

      {view === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">SPCC Initial Plans</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.spccInitialPending}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">pending initial completion</span>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">SPCC Renewals</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.spccRenewalsDue}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">renewals due or overdue</span>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Inspections</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.inspectionsDue}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">due or overdue</span>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search facilities..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('compliant')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'compliant'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                Compliant
              </button>
              <button
                onClick={() => setFilter('upcoming')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'upcoming'
                    ? 'bg-yellow-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                Due Soon
              </button>
              <button
                onClick={() => setFilter('overdue')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'overdue'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                Overdue
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Facility
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  SPCC Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Inspection Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Next Due
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredFacilities.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No facilities found
                  </td>
                </tr>
              ) : (
                filteredFacilities.map((fc) => (
                  <tr key={fc.facility.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{fc.facility.name}</div>
                      {fc.facility.first_prod_date && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          IP Date: {new Date(fc.facility.first_prod_date).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        {fc.spccCompliance ? (
                          <>
                            {fc.spccCompliance.compliance_status === 'not_started' && 'Not Started'}
                            {fc.spccCompliance.compliance_status === 'initial_due' && 'Initial Due'}
                            {fc.spccCompliance.compliance_status === 'initial_complete' && 'Initial Complete'}
                            {fc.spccCompliance.compliance_status === 'renewal_due' && 'Renewal Due'}
                            {fc.spccCompliance.compliance_status === 'renewal_complete' && 'Renewal Complete'}
                            {fc.spccCompliance.compliance_status === 'overdue' && 'Overdue'}
                            {fc.spccCompliance.compliance_status === 'expiring' && 'Expiring'}
                            {fc.spccCompliance.pe_stamp_date && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                PE Stamp: {new Date(fc.spccCompliance.pe_stamp_date).toLocaleDateString()}
                              </div>
                            )}
                          </>
                        ) : (
                          'No IP Date'
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        {fc.facility.last_inspection_date ? (
                          <>
                            Last: {new Date(fc.facility.last_inspection_date).toLocaleDateString()}
                          </>
                        ) : (
                          'None'
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900 dark:text-gray-100">
                        {fc.spccCompliance?.current_renewal_due_date || fc.facility.next_inspection_due ? (
                          <>
                            {new Date(
                              fc.spccCompliance?.current_renewal_due_date || fc.facility.next_inspection_due!
                            ).toLocaleDateString()}
                            {fc.daysUntilDue !== undefined && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {fc.daysUntilDue < 0 ? `${Math.abs(fc.daysUntilDue)} days overdue` : `${fc.daysUntilDue} days`}
                              </div>
                            )}
                          </>
                        ) : (
                          'N/A'
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {getComplianceStatusBadge(fc)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {onViewFacility && (
                        <button
                          onClick={() => onViewFacility(fc.facility.id)}
                          className="text-blue-500 hover:text-blue-600 inline-flex items-center gap-1 text-sm"
                        >
                          <ExternalLink className="w-4 h-4" />
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
