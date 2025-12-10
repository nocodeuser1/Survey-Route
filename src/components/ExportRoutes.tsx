import { useState } from 'react';
import { Download, Users, MapPin, FileText } from 'lucide-react';
import { OptimizationResult } from '../services/routeOptimizer';
import { Facility } from '../lib/supabase';
import { formatTimeTo12Hour, calculateTimeDifference } from '../utils/timeFormat';

interface ExportRoutesProps {
  result: OptimizationResult;
  facilities: Facility[];
  homeBase?: { latitude: string; longitude: string; };
}

type TeamDirection = 'north' | 'south' | 'east' | 'west';

interface TeamMember {
  id: number;
  direction: TeamDirection;
}

export default function ExportRoutes({ result, facilities, homeBase }: ExportRoutesProps) {
  const [teamSize, setTeamSize] = useState(1);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([
    { id: 1, direction: 'north' },
  ]);
  const [showTeamConfig, setShowTeamConfig] = useState(false);

  const updateTeamSize = (size: number) => {
    setTeamSize(size);
    const newMembers: TeamMember[] = [];
    for (let i = 0; i < size; i++) {
      newMembers.push({
        id: i + 1,
        direction: teamMembers[i]?.direction || 'north',
      });
    }
    setTeamMembers(newMembers);
  };

  const updateTeamDirection = (memberId: number, direction: TeamDirection) => {
    setTeamMembers(
      teamMembers.map((m) => (m.id === memberId ? { ...m, direction } : m))
    );
  };

  const calculateCentroid = (facilities: Facility[]) => {
    const sumLat = facilities.reduce((sum, f) => sum + Number(f.latitude), 0);
    const sumLon = facilities.reduce((sum, f) => sum + Number(f.longitude), 0);
    return {
      lat: sumLat / facilities.length,
      lon: sumLon / facilities.length,
    };
  };

  const assignFacilitiesToTeams = () => {
    if (teamSize === 1) {
      return [{ member: teamMembers[0], facilities: result.routes }];
    }

    const centroid = calculateCentroid(facilities);
    const facilitiesWithDirection = facilities.map((f) => {
      const lat = Number(f.latitude);
      const lon = Number(f.longitude);
      const latDiff = lat - centroid.lat;
      const lonDiff = lon - centroid.lon;

      let direction: TeamDirection;
      if (Math.abs(latDiff) > Math.abs(lonDiff)) {
        direction = latDiff > 0 ? 'north' : 'south';
      } else {
        direction = lonDiff > 0 ? 'east' : 'west';
      }

      return { ...f, direction };
    });

    const teamAssignments = teamMembers.map((member) => {
      const memberFacilities = facilitiesWithDirection.filter(
        (f) => f.direction === member.direction
      );

      const memberRoutes = result.routes.map((route) => ({
        ...route,
        facilities: route.facilities.filter((rf) =>
          memberFacilities.some((mf) => mf.name === rf.name)
        ),
      })).filter(route => route.facilities.length > 0);

      return {
        member,
        routes: memberRoutes,
        facilityCount: memberFacilities.length,
      };
    });

    return teamAssignments;
  };

  const exportToCSV = () => {
    if (teamSize === 1) {
      const csv = generateSingleTeamCSV();
      downloadCSV(csv, 'route-plan.csv');
    } else {
      const assignments = assignFacilitiesToTeams();
      assignments.forEach((assignment) => {
        const csv = generateTeamCSV(assignment);
        downloadCSV(
          csv,
          `route-plan-team${assignment.member.id}-${assignment.member.direction}.csv`
        );
      });
    }
  };

  const generateSingleTeamCSV = () => {
    const rows = [['Day-Stop-Facility', 'Facility Name', 'Arrival Time', 'Departure Time', 'Hrs:Min from Last Stop', 'Miles from Previous']];

    result.routes.forEach((route) => {
      let previousTime = route.startTime;
      route.segments.forEach((segment, idx) => {
        const facilityName = segment.to === 'Home Base' ? 'Return Home' : segment.to;
        const dayStopFacility = `Day ${route.day}-Stop ${idx + 1}-${facilityName}`;
        const timeDiff = calculateTimeDifference(previousTime, segment.arrivalTime);

        rows.push([
          dayStopFacility,
          facilityName,
          formatTimeTo12Hour(segment.arrivalTime),
          formatTimeTo12Hour(segment.departureTime),
          timeDiff,
          segment.distance.toFixed(2),
        ]);

        previousTime = segment.to === 'Home Base' ? segment.arrivalTime : segment.departureTime;
      });
    });

    return rows.map((row) => row.join(',')).join('\n');
  };

  const generateTeamCSV = (assignment: any) => {
    const rows = [['Day-Stop-Facility', 'Facility Name', 'Arrival Time', 'Departure Time', 'Hrs:Min from Last Stop', 'Miles from Previous']];

    assignment.routes.forEach((route: any) => {
      let previousTime = route.startTime;
      route.segments.forEach((segment: any, idx: number) => {
        const facilityName = segment.to === 'Home Base' ? 'Return Home' : segment.to;
        const dayStopFacility = `Day ${route.day}-Stop ${idx + 1}-${facilityName}`;
        const timeDiff = calculateTimeDifference(previousTime, segment.arrivalTime);

        rows.push([
          dayStopFacility,
          facilityName,
          formatTimeTo12Hour(segment.arrivalTime),
          formatTimeTo12Hour(segment.departureTime),
          timeDiff,
          segment.distance.toFixed(2),
        ]);

        previousTime = segment.to === 'Home Base' ? segment.arrivalTime : segment.departureTime;
      });
    });

    return rows.map((row) => row.join(',')).join('\n');
  };

  const downloadCSV = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportClientReport = () => {
    const COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Route Plan - Client Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #f9fafb;
      padding: 40px 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      border-radius: 8px;
      overflow: hidden;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }

    .header h1 {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .header p {
      font-size: 16px;
      opacity: 0.95;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      padding: 30px 40px;
      background: #f3f4f6;
      border-bottom: 2px solid #e5e7eb;
    }

    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .summary-card .label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .summary-card .value {
      font-size: 28px;
      font-weight: 700;
      color: #667eea;
    }


    .routes-section {
      padding: 40px;
    }

    .routes-section h2 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 30px;
      color: #1f2937;
      text-align: center;
    }

    .day-card {
      margin-bottom: 30px;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .day-header {
      padding: 20px 30px;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .day-header h3 {
      font-size: 20px;
      font-weight: 700;
    }

    .day-stats {
      display: flex;
      gap: 20px;
      font-size: 14px;
    }

    .facility-list {
      background: white;
      padding: 20px 30px;
    }

    .facility-item {
      padding: 15px 0;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .facility-item:last-child {
      border-bottom: none;
    }

    .stop-number {
      width: 35px;
      height: 35px;
      border-radius: 50%;
      background: #f3f4f6;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
      flex-shrink: 0;
    }

    .facility-name {
      flex: 1;
      font-size: 15px;
      color: #374151;
    }

    .footer {
      background: #f9fafb;
      padding: 30px 40px;
      text-align: center;
      color: #6b7280;
      font-size: 14px;
      border-top: 2px solid #e5e7eb;
    }

    @media print {
      body {
        padding: 0;
        background: white;
      }

      .container {
        box-shadow: none;
      }

      .day-card {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Route Plan</h1>
      <p>Optimized Facility Visit Schedule</p>
    </div>

    <div class="summary">
      <div class="summary-card">
        <div class="label">Total Days</div>
        <div class="value">${result.totalDays}</div>
      </div>
      <div class="summary-card">
        <div class="label">Facilities</div>
        <div class="value">${result.totalFacilities}</div>
      </div>
      <div class="summary-card">
        <div class="label">Total Miles</div>
        <div class="value">${result.totalMiles.toFixed(0)}</div>
      </div>
    </div>

    <div class="routes-section">
      <h2>Daily Schedule</h2>

      ${result.routes.map((route, routeIdx) => {
        const color = COLORS[routeIdx % COLORS.length];
        return `
          <div class="day-card">
            <div class="day-header" style="background: linear-gradient(135deg, ${color} 0%, ${color}dd 100%);">
              <h3>Day ${route.day}</h3>
              <div class="day-stats">
                <span>${route.facilities.length} Stops</span>
                <span>${route.totalMiles.toFixed(1)} mi</span>
              </div>
            </div>
            <div class="facility-list">
              ${route.facilities.map((facility, idx) => `
                <div class="facility-item">
                  <div class="stop-number" style="color: ${color}; border: 2px solid ${color};">${idx + 1}</div>
                  <div class="facility-name">${facility.name}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="footer">
      <p>Generated on ${new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}</p>
    </div>
  </div>
</body>
</html>`;

    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
    }
  };

  return (
    <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
            <Users className="inline w-4 h-4 mr-1" />
            Team Size
          </label>
          <input
            type="number"
            min="1"
            max="4"
            value={teamSize}
            onChange={(e) => {
              const val = e.target.value === '' ? 1 : parseInt(e.target.value);
              if (val >= 1 && val <= 4) {
                updateTeamSize(val);
              }
            }}
            onFocus={(e) => e.target.select()}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-500 mt-1">
            Split workload across multiple team members (1-4 people)
          </p>
        </div>

        {teamSize > 1 && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-800 font-medium mb-2">
              Multi-Team Configuration Required
            </p>
            <p className="text-sm text-blue-700">
              To split work across {teamSize} teams, please configure {teamSize} home bases in the Home Base tab.
              Each team will be assigned facilities closest to their home base.
            </p>
          </div>
        )}

        {teamSize > 1 && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-800">
              <MapPin className="inline w-4 h-4 mr-1" />
              {result.totalFacilities} facilities will be split across {teamSize} team members
              based on geographic location.
            </p>
          </div>
        )}

        <div className="pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Export Options</h4>

          <div className="space-y-3">
            <button
              onClick={exportClientReport}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              <FileText className="w-5 h-5" />
              Export for Client (Print View)
            </button>

            <button
              onClick={exportToCSV}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
            >
              <Download className="w-5 h-5" />
              {teamSize === 1
                ? 'Export to CSV'
                : `Export ${teamSize} Team Plans (CSV)`}
            </button>
          </div>
        </div>
    </div>
  );
}
