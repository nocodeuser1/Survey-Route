import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Clock, FileWarning, TrendingUp } from 'lucide-react';
import { ParsedFacility } from '../utils/csvParser';

interface SPCCComplianceValidatorProps {
  facilities: ParsedFacility[];
  onProceed: () => void;
  onCancel: () => void;
}

interface ComplianceIssue {
  severity: 'error' | 'warning' | 'info';
  facility: ParsedFacility;
  message: string;
  type: 'no_ip_date' | 'initial_overdue' | 'initial_due_soon' | 'renewal_overdue' | 'renewal_due_soon' | 'invalid_date' | 'late_completion';
}

export default function SPCCComplianceValidator({ facilities, onProceed, onCancel }: SPCCComplianceValidatorProps) {
  const [issues, setIssues] = useState<ComplianceIssue[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    withIPDate: 0,
    withoutIPDate: 0,
    initialOverdue: 0,
    initialDueSoon: 0,
    renewalOverdue: 0,
    renewalDueSoon: 0,
    compliant: 0,
  });

  useEffect(() => {
    analyzeFacilities();
  }, [facilities]);

  const analyzeFacilities = () => {
    const foundIssues: ComplianceIssue[] = [];
    const today = new Date();

    let withIPDate = 0;
    let withoutIPDate = 0;
    let initialOverdue = 0;
    let initialDueSoon = 0;
    let renewalOverdue = 0;
    let renewalDueSoon = 0;
    let compliant = 0;

    facilities.forEach(facility => {
      if (!facility.first_prod_date) {
        withoutIPDate++;
        foundIssues.push({
          severity: 'info',
          facility,
          message: 'Missing Initial Production Date - SPCC compliance cannot be calculated',
          type: 'no_ip_date',
        });
        return;
      }

      withIPDate++;

      const ipDate = parseDate(facility.first_prod_date);
      if (!ipDate || isNaN(ipDate.getTime())) {
        foundIssues.push({
          severity: 'error',
          facility,
          message: `Invalid Initial Production Date format: "${facility.first_prod_date}"`,
          type: 'invalid_date',
        });
        return;
      }

      const initialDueDate = new Date(ipDate);
      initialDueDate.setMonth(initialDueDate.getMonth() + 6);

      const spccCompletedDate = facility.spcc_inspection_date ? parseDate(facility.spcc_inspection_date) : null;

      if (!spccCompletedDate) {
        const daysUntilInitialDue = Math.floor((initialDueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (daysUntilInitialDue < 0) {
          initialOverdue++;
          foundIssues.push({
            severity: 'error',
            facility,
            message: `Initial SPCC plan overdue by ${Math.abs(daysUntilInitialDue)} days (due: ${initialDueDate.toLocaleDateString()})`,
            type: 'initial_overdue',
          });
        } else if (daysUntilInitialDue <= 30) {
          initialDueSoon++;
          foundIssues.push({
            severity: 'warning',
            facility,
            message: `Initial SPCC plan due in ${daysUntilInitialDue} days (${initialDueDate.toLocaleDateString()})`,
            type: 'initial_due_soon',
          });
        } else {
          compliant++;
        }
      } else {
        if (spccCompletedDate > initialDueDate) {
          foundIssues.push({
            severity: 'warning',
            facility,
            message: `Initial SPCC plan completed ${Math.floor((spccCompletedDate.getTime() - initialDueDate.getTime()) / (1000 * 60 * 60 * 24))} days late`,
            type: 'late_completion',
          });
        }

        const renewalDueDate = new Date(spccCompletedDate);
        renewalDueDate.setFullYear(renewalDueDate.getFullYear() + 5);

        const daysUntilRenewal = Math.floor((renewalDueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        if (daysUntilRenewal < 0) {
          renewalOverdue++;
          foundIssues.push({
            severity: 'error',
            facility,
            message: `SPCC renewal overdue by ${Math.abs(daysUntilRenewal)} days (due: ${renewalDueDate.toLocaleDateString()})`,
            type: 'renewal_overdue',
          });
        } else if (daysUntilRenewal <= 90) {
          renewalDueSoon++;
          foundIssues.push({
            severity: 'warning',
            facility,
            message: `SPCC renewal due in ${daysUntilRenewal} days (${renewalDueDate.toLocaleDateString()})`,
            type: 'renewal_due_soon',
          });
        } else {
          compliant++;
        }
      }
    });

    setIssues(foundIssues);
    setStats({
      total: facilities.length,
      withIPDate,
      withoutIPDate,
      initialOverdue,
      initialDueSoon,
      renewalOverdue,
      renewalDueSoon,
      compliant,
    });
  };

  const parseDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;

    const formats = [
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
      /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    ];

    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        if (format === formats[1]) {
          return new Date(`${match[1]}-${match[2]}-${match[3]}`);
        } else if (format === formats[0]) {
          return new Date(`${match[3]}-${match[1]}-${match[2]}`);
        } else {
          return new Date(`${match[3]}-${match[1]}-${match[2]}`);
        }
      }
    }

    const attemptParse = new Date(dateStr);
    return isNaN(attemptParse.getTime()) ? null : attemptParse;
  };

  const errorIssues = issues.filter(i => i.severity === 'error');
  const warningIssues = issues.filter(i => i.severity === 'warning');
  const infoIssues = issues.filter(i => i.severity === 'info');

  const criticalCount = stats.initialOverdue + stats.renewalOverdue;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FileWarning className="w-5 h-5 text-blue-500" />
          SPCC Compliance Analysis
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Facilities</div>
          </div>

          <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.compliant}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Compliant</div>
          </div>

          <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {stats.initialDueSoon + stats.renewalDueSoon}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Due Soon</div>
          </div>

          <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{criticalCount}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Overdue</div>
          </div>
        </div>

        {stats.withoutIPDate > 0 && (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg flex items-start gap-2">
            <Clock className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium">{stats.withoutIPDate} facilities missing Initial Production Date</div>
              <div className="text-sm mt-1">
                SPCC compliance cannot be calculated without an Initial Production Date. These facilities will be imported but compliance tracking will not be available.
              </div>
            </div>
          </div>
        )}

        {criticalCount > 0 && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium">{criticalCount} facilities have overdue SPCC requirements</div>
              <div className="text-sm mt-1">
                These facilities require immediate attention to maintain compliance.
              </div>
            </div>
          </div>
        )}

        {(stats.initialDueSoon + stats.renewalDueSoon) > 0 && (
          <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 rounded-lg flex items-start gap-2">
            <Clock className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium">{stats.initialDueSoon + stats.renewalDueSoon} facilities have SPCC due soon</div>
              <div className="text-sm mt-1">
                These facilities will require SPCC plan updates within the next 30-90 days.
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <details className="bg-gray-50 dark:bg-gray-700/50 rounded-lg" open={errorIssues.length > 0}>
            <summary className="cursor-pointer p-3 font-medium text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Critical Issues ({errorIssues.length})
            </summary>
            <div className="p-3 space-y-2 max-h-60 overflow-y-auto">
              {errorIssues.map((issue, idx) => (
                <div key={idx} className="text-sm bg-white dark:bg-gray-800 p-3 rounded border border-red-200 dark:border-red-800">
                  <div className="font-medium text-gray-900 dark:text-gray-100">{issue.facility.name}</div>
                  <div className="text-red-600 dark:text-red-400 mt-1">{issue.message}</div>
                </div>
              ))}
            </div>
          </details>

          <details className="bg-gray-50 dark:bg-gray-700/50 rounded-lg" open={warningIssues.length > 0 && errorIssues.length === 0}>
            <summary className="cursor-pointer p-3 font-medium text-yellow-600 dark:text-yellow-400 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Warnings ({warningIssues.length})
            </summary>
            <div className="p-3 space-y-2 max-h-60 overflow-y-auto">
              {warningIssues.map((issue, idx) => (
                <div key={idx} className="text-sm bg-white dark:bg-gray-800 p-3 rounded border border-yellow-200 dark:border-yellow-800">
                  <div className="font-medium text-gray-900 dark:text-gray-100">{issue.facility.name}</div>
                  <div className="text-yellow-600 dark:text-yellow-400 mt-1">{issue.message}</div>
                </div>
              ))}
            </div>
          </details>

          {infoIssues.length > 0 && (
            <details className="bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <summary className="cursor-pointer p-3 font-medium text-blue-600 dark:text-blue-400 flex items-center gap-2">
                <FileWarning className="w-4 h-4" />
                Information ({infoIssues.length})
              </summary>
              <div className="p-3 space-y-2 max-h-60 overflow-y-auto">
                {infoIssues.map((issue, idx) => (
                  <div key={idx} className="text-sm bg-white dark:bg-gray-800 p-3 rounded border border-blue-200 dark:border-blue-800">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{issue.facility.name}</div>
                    <div className="text-blue-600 dark:text-blue-400 mt-1">{issue.message}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Cancel Import
        </button>
        <button
          onClick={onProceed}
          className="px-6 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          {criticalCount > 0 ? 'Import Anyway' : 'Proceed with Import'}
        </button>
      </div>
    </div>
  );
}
