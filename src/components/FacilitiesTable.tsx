import { useState, useEffect } from 'react';
import { MapPin, Trash2, FileText, CheckCircle, AlertCircle, Search, Filter, Eye, Maximize2 } from 'lucide-react';
import { Facility, Inspection, supabase } from '../lib/supabase';
import FacilityDetailModal from './FacilityDetailModal';
import InspectionViewer from './InspectionViewer';
import SPCCExternalCompletionBadge from './SPCCExternalCompletionBadge';
import { isInspectionValid } from '../utils/inspectionUtils';

interface FacilitiesTableProps {
  facilities: Facility[];
  userId: string;
  teamNumber?: number;
  onDelete?: () => void;
  accountId?: string;
}

export default function FacilitiesTable({ facilities, userId, teamNumber = 1, onDelete, accountId }: FacilitiesTableProps) {
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [inspections, setInspections] = useState<Map<string, Inspection>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'inspected' | 'pending' | 'expired'>('all');
  const [sortField, setSortField] = useState<'name' | 'day' | 'status'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);

  useEffect(() => {
    loadInspections();
  }, [facilities]);

  const loadInspections = async () => {
    try {
      const facilityIds = facilities.map(f => f.id);
      if (facilityIds.length === 0) return;

      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .in('facility_id', facilityIds)
        .eq('status', 'completed')
        .order('conducted_at', { ascending: false });

      if (error) throw error;

      const inspectionMap = new Map<string, Inspection>();
      data?.forEach(inspection => {
        if (!inspectionMap.has(inspection.facility_id)) {
          inspectionMap.set(inspection.facility_id, inspection);
        }
      });
      setInspections(inspectionMap);
    } catch (err) {
      console.error('Error loading inspections:', err);
    }
  };

  const getVerificationIcon = (facility: Facility) => {
    // Check for completion type first (internal or external)
    if (facility.spcc_completion_type === 'internal' && facility.spcc_completed_date) {
      const completedDate = new Date(facility.spcc_completed_date);
      const oneYearFromCompletion = new Date(completedDate);
      oneYearFromCompletion.setFullYear(oneYearFromCompletion.getFullYear() + 1);
      const now = new Date();

      if (now > oneYearFromCompletion) {
        return <AlertCircle className="w-4 h-4 text-orange-500" title="Internal completion expired - Reinspection needed" />;
      }
      return <CheckCircle className="w-4 h-4 text-blue-600" title="SPCC Completed Internally - Inspection within last year" />;
    } else if (facility.spcc_completion_type === 'external' && facility.spcc_completed_date) {
      const completedDate = new Date(facility.spcc_completed_date);
      const oneYearFromCompletion = new Date(completedDate);
      oneYearFromCompletion.setFullYear(oneYearFromCompletion.getFullYear() + 1);
      const now = new Date();

      if (now > oneYearFromCompletion) {
        return <AlertCircle className="w-4 h-4 text-orange-500" title="External completion expired - Reinspection needed" />;
      }
      return <CheckCircle className="w-4 h-4 text-yellow-600" title="SPCC Completed Externally - Inspection within last year" />;
    }

    // Fall back to checking inspection records
    const inspection = inspections.get(facility.id);
    if (isInspectionValid(inspection)) {
      return <CheckCircle className="w-4 h-4 text-green-600" title="Verified - Inspection within last year" />;
    } else if (inspection) {
      return <AlertCircle className="w-4 h-4 text-orange-500" title="Inspection expired - Reinspection needed" />;
    }
    return null;
  };

  const getInspectionStatus = (facility: Facility): 'inspected' | 'pending' | 'expired' => {
    // Check for internal or external completion
    if (facility.spcc_completion_type && facility.spcc_completed_date) {
      const spccDate = new Date(facility.spcc_completed_date);
      const oneYearFromSpcc = new Date(spccDate);
      oneYearFromSpcc.setFullYear(oneYearFromSpcc.getFullYear() + 1);
      const now = new Date();

      if (now > oneYearFromSpcc) {
        return 'expired';
      }
      return 'inspected';
    }

    const inspection = inspections.get(facility.id);
    if (!inspection) return 'pending';
    return isInspectionValid(inspection) ? 'inspected' : 'expired';
  };

  const getFilteredAndSortedFacilities = () => {
    let filtered = facilities.filter(facility => {
      const matchesSearch = !searchQuery ||
        facility.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        facility.address?.toLowerCase().includes(searchQuery.toLowerCase());

      const status = getInspectionStatus(facility);
      const matchesStatus = statusFilter === 'all' || status === statusFilter;

      return matchesSearch && matchesStatus;
    });

    filtered.sort((a, b) => {
      let comparison = 0;

      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'day') {
        comparison = (a.day || 0) - (b.day || 0);
      } else if (sortField === 'status') {
        const statusA = getInspectionStatus(a);
        const statusB = getInspectionStatus(b);
        const order = { pending: 0, expired: 1, inspected: 2 };
        comparison = order[statusA] - order[statusB];
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  };

  const handleSort = (field: 'name' | 'day' | 'status') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredFacilities = getFilteredAndSortedFacilities();

  if (facilities.length === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden transition-colors duration-200">
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 transition-colors duration-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white">
              Facilities ({filteredFacilities.length} of {facilities.length})
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear All
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search facilities..."
              className="w-full px-3 py-2 pl-9 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-colors duration-200"
            />
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-500" />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-colors duration-200"
          >
            <option value="all">All Status</option>
            <option value="inspected">Inspected</option>
            <option value="pending">Pending</option>
            <option value="expired">Expired</option>
          </select>

          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value as any)}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-colors duration-200"
          >
            <option value="name">Sort by Name</option>
            <option value="day">Sort by Day</option>
            <option value="status">Sort by Status</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto max-h-96 bg-white dark:bg-gray-800">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 sticky top-0 transition-colors duration-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => handleSort('name')}>
                <div className="flex items-center gap-1">
                  Facility Name
                  {sortField === 'name' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                </div>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Address
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => handleSort('day')}>
                <div className="flex items-center gap-1">
                  Day
                  {sortField === 'day' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                </div>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => handleSort('status')}>
                <div className="flex items-center gap-1">
                  Status
                  {sortField === 'status' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                </div>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
            {filteredFacilities.map((facility, index) => {
              const facilityInspection = inspections.get(facility.id);
              const status = getInspectionStatus(facility);

              return (
                <tr
                  key={facility.id}
                  className={`hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors ${
                    index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'
                  }`}
                >
                  <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span className="font-medium">{facility.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                    {facility.address || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                    {facility.day ? `Day ${facility.day}` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                      status === 'inspected' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' :
                      status === 'expired' ? 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200' :
                      'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200'
                    }`}
                      {status === 'inspected' && <CheckCircle className="w-3 h-3" />}
                      {status === 'expired' && <AlertCircle className="w-3 h-3" />}
                      {status === 'inspected' ? 'Inspected' : status === 'expired' ? 'Expired' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedFacility(facility)}
                        className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 rounded transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {facilityInspection && (
                        <button
                          onClick={() => setViewingInspection(facilityInspection)}
                          className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900 rounded transition-colors"
                          title="View Inspection"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedFacility && (
        <FacilityDetailModal
          facility={selectedFacility}
          userId={userId}
          teamNumber={teamNumber}
          onClose={() => {
            setSelectedFacility(null);
            loadInspections();
          }}
          facilities={facilities}
          allInspections={inspections}
          onViewNearbyFacility={(facility) => {
            setSelectedFacility(facility);
          }}
        />
      )}

      {viewingInspection && accountId && (() => {
        const viewingFacility = facilities.find(f => f.id === viewingInspection.facility_id);
        if (!viewingFacility) return null;

        return (
          <InspectionViewer
            inspection={viewingInspection}
            facility={viewingFacility}
            onClose={() => setViewingInspection(null)}
            onClone={() => {}}
            canClone={false}
            userId={userId}
            accountId={accountId}
          />
        );
      })()}

    </div>
  );
}
