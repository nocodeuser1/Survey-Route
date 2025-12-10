import { useState, useEffect } from 'react';
import { Calendar, CheckCircle, Clock, AlertTriangle, FileText, TrendingUp } from 'lucide-react';
import { supabase, Facility, SPCCComplianceTracking } from '../lib/supabase';

interface FacilityComplianceTimelineProps {
  facility: Facility;
  accountId: string;
}

export default function FacilityComplianceTimeline({ facility, accountId }: FacilityComplianceTimelineProps) {
  const [compliance, setCompliance] = useState<SPCCComplianceTracking | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCompliance();
  }, [facility.id]);

  const loadCompliance = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('spcc_compliance_tracking')
        .select('*')
        .eq('facility_id', facility.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      setCompliance(data);
    } catch (error) {
      console.error('Error loading compliance:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!facility.first_prod_date || !compliance) {
    return (
      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg">
        <div className="flex items-start gap-2">
          <FileText className="w-5 h-5 mt-0.5" />
          <div>
            <div className="font-medium">No SPCC Compliance Data</div>
            <div className="text-sm mt-1">
              {!facility.first_prod_date
                ? 'Add an Initial Production Date to track SPCC compliance for this facility.'
                : 'Compliance tracking data is being calculated. Please refresh in a moment.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'not_started':
        return <FileText className="w-5 h-5 text-gray-400" />;
      case 'initial_due':
      case 'renewal_due':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'initial_complete':
      case 'renewal_complete':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'overdue':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      default:
        return <FileText className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'text-gray-600 dark:text-gray-400';
      case 'initial_due':
      case 'renewal_due':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'initial_complete':
      case 'renewal_complete':
        return 'text-green-600 dark:text-green-400';
      case 'overdue':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'Not Started';
      case 'initial_due':
        return 'Initial Plan Due';
      case 'initial_complete':
        return 'Initial Plan Complete';
      case 'renewal_due':
        return 'Renewal Due';
      case 'renewal_complete':
        return 'Renewal Complete';
      case 'overdue':
        return 'Overdue';
      default:
        return status;
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Not set';
    return new Date(dateStr).toLocaleDateString();
  };

  const timelineEvents = [];

  if (compliance.initial_production_date) {
    timelineEvents.push({
      date: compliance.initial_production_date,
      label: 'Initial Production Date',
      icon: <Calendar className="w-4 h-4" />,
      color: 'text-blue-500',
    });
  }

  if (compliance.initial_spcc_due_date) {
    timelineEvents.push({
      date: compliance.initial_spcc_due_date,
      label: 'Initial SPCC Due',
      icon: <Clock className="w-4 h-4" />,
      color: compliance.initial_spcc_completed_date ? 'text-gray-400' : 'text-yellow-500',
    });
  }

  if (compliance.initial_spcc_completed_date) {
    timelineEvents.push({
      date: compliance.initial_spcc_completed_date,
      label: 'Initial SPCC Completed',
      icon: <CheckCircle className="w-4 h-4" />,
      color: 'text-green-500',
    });
  }

  if (compliance.current_renewal_due_date && compliance.renewal_cycle_number > 0) {
    timelineEvents.push({
      date: compliance.current_renewal_due_date,
      label: `Renewal ${compliance.renewal_cycle_number} Due`,
      icon: <TrendingUp className="w-4 h-4" />,
      color: compliance.current_renewal_completed_date ? 'text-gray-400' : 'text-yellow-500',
    });
  }

  if (compliance.current_renewal_completed_date && compliance.renewal_cycle_number > 0) {
    timelineEvents.push({
      date: compliance.current_renewal_completed_date,
      label: `Renewal ${compliance.renewal_cycle_number} Completed`,
      icon: <CheckCircle className="w-4 h-4" />,
      color: 'text-green-500',
    });
  }

  timelineEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
        <div className="flex items-center gap-2">
          {getStatusIcon(compliance.compliance_status)}
          <div>
            <div className={`font-semibold ${getStatusColor(compliance.compliance_status)}`}>
              {getStatusLabel(compliance.compliance_status)}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {compliance.is_compliant ? 'Facility is compliant' : 'Action required'}
            </div>
          </div>
        </div>

        {compliance.days_until_due !== null && (
          <div className="ml-auto text-right">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {compliance.days_until_due < 0 ? Math.abs(compliance.days_until_due) : compliance.days_until_due}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              days {compliance.days_until_due < 0 ? 'overdue' : 'until due'}
            </div>
          </div>
        )}
      </div>

      <div>
        <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Timeline</h4>
        <div className="space-y-3">
          {timelineEvents.map((event, index) => {
            const eventDate = new Date(event.date);
            const isPast = eventDate < new Date();

            return (
              <div key={index} className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  isPast ? 'bg-gray-100 dark:bg-gray-700' : 'bg-blue-100 dark:bg-blue-900/30'
                }`}>
                  <div className={event.color}>{event.icon}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{event.label}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(event.date)}
                    </div>
                  </div>
                  {index < timelineEvents.length - 1 && (
                    <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 ml-4 mt-1"></div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {compliance.renewal_cycle_number > 0 && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg">
          <div className="flex items-start gap-2">
            <TrendingUp className="w-5 h-5 mt-0.5" />
            <div>
              <div className="font-medium">Renewal Cycle {compliance.renewal_cycle_number}</div>
              <div className="text-sm mt-1">
                This facility is on renewal cycle {compliance.renewal_cycle_number}. SPCC plans must be renewed every 5 years.
              </div>
            </div>
          </div>
        </div>
      )}

      {facility.next_inspection_due && (
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Inspection Schedule</h4>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">Next Inspection Due</div>
              {facility.last_inspection_date && (
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Last: {formatDate(facility.last_inspection_date)}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="font-semibold text-gray-900 dark:text-gray-100">
                {formatDate(facility.next_inspection_due)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {facility.inspection_frequency_days ? `Every ${facility.inspection_frequency_days} days` : 'Annual'}
              </div>
            </div>
          </div>
        </div>
      )}

      {compliance.notes && (
        <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">Notes</h4>
          <div className="text-sm text-gray-600 dark:text-gray-400 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            {compliance.notes}
          </div>
        </div>
      )}
    </div>
  );
}
