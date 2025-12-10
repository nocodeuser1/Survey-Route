import { useState, useRef } from 'react';
import { Upload, Trash2, AlertTriangle, Database, FileDown, CheckCircle, XCircle } from 'lucide-react';
import { supabase, Facility, Inspection, RoutePlan, InspectionPhoto } from '../lib/supabase';
import JSZip from 'jszip';

interface DataBackupProps {
  accountId: string;
  facilities: Facility[];
  onFacilitiesChange: () => void;
}

interface BackupData {
  version: string;
  exportDate: string;
  accountId: string;
  facilities: Facility[];
  inspections: Inspection[];
  inspectionPhotos: (InspectionPhoto & { original_inspection_id?: string })[];
  routePlans: RoutePlan[];
}

export default function DataBackup({ accountId, facilities, onFacilitiesChange }: DataBackupProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showClearAllWarning, setShowClearAllWarning] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0, stage: '' });
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState({ current: 0, total: 0, stage: '' });
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportFullBackup = async () => {
    setIsExporting(true);
    setExportProgress({ current: 0, total: 0, stage: 'Preparing export...' });

    try {
      setExportProgress({ current: 0, total: 4, stage: 'Fetching inspections...' });
      const { data: inspectionsData } = await supabase
        .from('inspections')
        .select('*')
        .eq('account_id', accountId);

      const inspectionIds = (inspectionsData || []).map(i => i.id);

      setExportProgress({ current: 1, total: 4, stage: 'Fetching inspection photos metadata...' });
      let photosData: InspectionPhoto[] = [];
      if (inspectionIds.length > 0) {
        const { data } = await supabase
          .from('inspection_photos')
          .select('*')
          .in('inspection_id', inspectionIds);
        photosData = data || [];
      }

      setExportProgress({ current: 2, total: 4, stage: 'Fetching route plans...' });
      const { data: routePlansData } = await supabase
        .from('route_plans')
        .select('*')
        .eq('account_id', accountId);

      const backupData: BackupData = {
        version: '2.0.0',
        exportDate: new Date().toISOString(),
        accountId,
        facilities,
        inspections: inspectionsData || [],
        inspectionPhotos: photosData.map(p => ({ ...p, original_inspection_id: p.inspection_id })),
        routePlans: routePlansData || []
      };

      setExportProgress({ current: 3, total: 4, stage: 'Creating backup archive...' });
      const zip = new JSZip();

      zip.file('backup.json', JSON.stringify(backupData, null, 2));

      if (photosData && photosData.length > 0) {
        setExportProgress({ current: 0, total: photosData.length, stage: 'Downloading photos...' });
        let completedPhotos = 0;

        const photoPromises = photosData.map(async (photo) => {
          try {
            if (photo.photo_url && !photo.photo_url.startsWith('data:')) {
              const storagePath = photo.photo_url.replace(/^.*\/inspection-photos\//, '');

              const { data: blob, error } = await supabase.storage
                .from('inspection-photos')
                .download(storagePath);

              if (!error && blob) {
                zip.file(`photos/${storagePath}`, blob);
              } else {
                console.warn(`Failed to download photo: ${storagePath}`, error);
              }
            }
          } catch (err) {
            console.error('Error processing photo:', err);
          } finally {
            completedPhotos++;
            setExportProgress({ current: completedPhotos, total: photosData.length, stage: 'Downloading photos...' });
          }
        });

        await Promise.all(photoPromises);
      }

      setExportProgress({ current: 4, total: 4, stage: 'Generating zip file...' });
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `surveyroute-backup-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      alert(`Successfully exported backup with:\n- ${facilities.length} facilities\n- ${inspectionsData?.length || 0} inspections\n- ${photosData?.length || 0} inspection photos (files included)\n- ${routePlansData?.length || 0} saved routes\n\nBackup includes actual photo files for easy migration!`);
    } catch (error) {
      console.error('Error exporting backup:', error);
      alert('Failed to export backup. Please try again.');
    } finally {
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0, stage: '' });
    }
  };

  const handleClearAllData = async () => {
    setIsClearing(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .delete()
        .eq('account_id', accountId);

      if (error) throw error;

      setShowClearAllWarning(false);
      onFacilitiesChange();
      alert('All facilities and associated data have been deleted successfully.');
    } catch (error) {
      console.error('Error clearing data:', error);
      alert('Failed to clear data. Please try again.');
    } finally {
      setIsClearing(false);
    }
  };

  const handleRestoreBackup = async (file: File) => {
    setIsRestoring(true);
    setRestoreResult(null);
    setRestoreProgress({ current: 0, total: 0, stage: 'Reading backup file...' });

    try {
      const zip = await JSZip.loadAsync(file);
      const backupJsonFile = zip.file('backup.json');

      if (!backupJsonFile) {
        throw new Error('Invalid backup file: backup.json not found');
      }

      const backupJsonText = await backupJsonFile.async('string');
      const backupData: BackupData = JSON.parse(backupJsonText);

      if (!backupData.version || !backupData.facilities) {
        throw new Error('Invalid backup file format');
      }

      const facilityIdMap = new Map<string, string>();
      const inspectionIdMap = new Map<string, string>();

      setRestoreProgress({ current: 0, total: backupData.facilities.length, stage: 'Restoring facilities...' });
      for (let i = 0; i < backupData.facilities.length; i++) {
        const facility = backupData.facilities[i];
        const oldId = facility.id;
        const { id, created_at, updated_at, ...facilityData } = facility;

        const { data: existingFacility } = await supabase
          .from('facilities')
          .select('id')
          .eq('account_id', accountId)
          .eq('name', facility.name)
          .eq('latitude', facility.latitude)
          .eq('longitude', facility.longitude)
          .maybeSingle();

        if (existingFacility) {
          facilityIdMap.set(oldId, existingFacility.id);
        } else {
          const { data: newFacility, error } = await supabase
            .from('facilities')
            .insert({ ...facilityData, account_id: accountId })
            .select()
            .single();

          if (error) {
            console.error('Error inserting facility:', error);
            continue;
          }
          facilityIdMap.set(oldId, newFacility.id);
        }
        setRestoreProgress({ current: i + 1, total: backupData.facilities.length, stage: 'Restoring facilities...' });
      }

      if (backupData.inspections && backupData.inspections.length > 0) {
        setRestoreProgress({ current: 0, total: backupData.inspections.length, stage: 'Restoring inspections...' });
        for (let i = 0; i < backupData.inspections.length; i++) {
          const inspection = backupData.inspections[i];
          const oldId = inspection.id;
          const newFacilityId = facilityIdMap.get(inspection.facility_id);

          if (!newFacilityId) {
            console.warn('Skipping inspection - facility not found:', inspection.facility_id);
            continue;
          }

          const { id, created_at, updated_at, ...inspectionData } = inspection;

          const { data: newInspection, error } = await supabase
            .from('inspections')
            .insert({
              ...inspectionData,
              facility_id: newFacilityId,
              account_id: accountId
            })
            .select()
            .single();

          if (error) {
            console.error('Error inserting inspection:', error);
            continue;
          }
          inspectionIdMap.set(oldId, newInspection.id);
          setRestoreProgress({ current: i + 1, total: backupData.inspections.length, stage: 'Restoring inspections...' });
        }
      }

      if (backupData.inspectionPhotos && backupData.inspectionPhotos.length > 0) {
        setRestoreProgress({ current: 0, total: backupData.inspectionPhotos.length, stage: 'Restoring photos...' });

        for (let i = 0; i < backupData.inspectionPhotos.length; i++) {
          const photo = backupData.inspectionPhotos[i];
          const originalInspectionId = photo.original_inspection_id || photo.inspection_id;
          const newInspectionId = inspectionIdMap.get(originalInspectionId);

          if (!newInspectionId) {
            console.warn('Skipping photo - inspection not found:', originalInspectionId);
            setRestoreProgress({ current: i + 1, total: backupData.inspectionPhotos.length, stage: 'Restoring photos...' });
            continue;
          }

          const oldStoragePath = photo.photo_url.replace(/^.*\/inspection-photos\//, '');
          const photoFile = zip.file(`photos/${oldStoragePath}`);

          if (photoFile) {
            try {
              const photoBlob = await photoFile.async('blob');
              const newStoragePath = `${newInspectionId}/${photo.question_id}/${Date.now()}_${i}.jpg`;

              const { error: uploadError } = await supabase.storage
                .from('inspection-photos')
                .upload(newStoragePath, photoBlob, { contentType: 'image/jpeg' });

              if (uploadError) {
                console.error('Error uploading photo:', uploadError);
                continue;
              }

              const { error: insertError } = await supabase
                .from('inspection_photos')
                .insert({
                  inspection_id: newInspectionId,
                  question_id: photo.question_id,
                  photo_url: newStoragePath,
                  file_name: photo.file_name,
                  file_size: photo.file_size
                });

              if (insertError) {
                console.error('Error inserting photo record:', insertError);
              }
            } catch (photoErr) {
              console.error('Error processing photo:', photoErr);
            }
          }
          setRestoreProgress({ current: i + 1, total: backupData.inspectionPhotos.length, stage: 'Restoring photos...' });
        }
      }

      if (backupData.routePlans && backupData.routePlans.length > 0) {
        setRestoreProgress({ current: 0, total: backupData.routePlans.length, stage: 'Restoring route plans...' });
        for (let i = 0; i < backupData.routePlans.length; i++) {
          const route = backupData.routePlans[i];
          const { id, created_at, updated_at, ...routeData } = route;

          if (routeData.facility_ids && Array.isArray(routeData.facility_ids)) {
            routeData.facility_ids = routeData.facility_ids
              .map((oldId: string) => facilityIdMap.get(oldId))
              .filter((id: string | undefined): id is string => id !== undefined);
          }

          const { error } = await supabase
            .from('route_plans')
            .insert({ ...routeData, account_id: accountId });

          if (error) {
            console.error('Error inserting route plan:', error);
          }
          setRestoreProgress({ current: i + 1, total: backupData.routePlans.length, stage: 'Restoring route plans...' });
        }
      }

      const restoredFacilities = facilityIdMap.size;
      const restoredInspections = inspectionIdMap.size;
      const restoredPhotos = backupData.inspectionPhotos?.length || 0;
      const restoredRoutes = backupData.routePlans?.length || 0;

      setRestoreResult({
        success: true,
        message: `Successfully restored:\n- ${restoredFacilities} facilities\n- ${restoredInspections} inspections\n- ${restoredPhotos} photos\n- ${restoredRoutes} saved routes`
      });

      onFacilitiesChange();
    } catch (error: any) {
      console.error('Error restoring backup:', error);
      setRestoreResult({
        success: false,
        message: error.message || 'Failed to restore backup'
      });
    } finally {
      setIsRestoring(false);
      setRestoreProgress({ current: 0, total: 0, stage: '' });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
          <Database className="w-5 h-5" />
          Data Backup & Export
        </h3>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Export a complete backup of your facilities, inspections, photos, and routes. This backup file can be used to restore your data.
        </p>

        <div className="space-y-4">
          <button
            onClick={exportFullBackup}
            disabled={isExporting || facilities.length === 0}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isExporting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <FileDown className="w-5 h-5" />
                Export Full Backup (ZIP)
              </>
            )}
          </button>

          {isExporting && exportProgress.total > 0 && (
            <div className="mt-4">
              <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                {exportProgress.stage}
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                />
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 text-right">
                {exportProgress.current} / {exportProgress.total}
              </div>
            </div>
          )}

          {facilities.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No data to export. Upload facilities first.</p>
          )}

          {facilities.length > 0 && (
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>What's included:</strong>
              </p>
              <ul className="text-sm text-blue-700 dark:text-blue-400 mt-2 ml-4 list-disc">
                <li>{facilities.length} facilities with coordinates and details</li>
                <li>All inspection records and responses</li>
                <li>All inspection photo files (downloaded from storage)</li>
                <li>Saved route plans and settings</li>
              </ul>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-3">
                <strong>Note:</strong> The backup includes actual photo files downloaded from Supabase storage, making it perfect for migrating to a new Supabase instance. The zip contains a backup.json file and a photos/ folder with all images.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border-2 border-green-200 dark:border-green-700">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-green-600" />
          Restore from Backup
        </h3>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Upload a backup file (.zip) to restore your facilities, inspections, photos, and routes. This will add the backup data to your current account.
        </p>

        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleRestoreBackup(file);
              }
            }}
            disabled={isRestoring}
            className="hidden"
            id="backup-file-input"
          />

          <label
            htmlFor="backup-file-input"
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg cursor-pointer transition-colors ${isRestoring
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
          >
            {isRestoring ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Restoring...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                Select Backup File (.zip)
              </>
            )}
          </label>

          {isRestoring && restoreProgress.total > 0 && (
            <div className="mt-4">
              <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                {restoreProgress.stage}
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                <div
                  className="bg-green-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${(restoreProgress.current / restoreProgress.total) * 100}%` }}
                />
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 text-right">
                {restoreProgress.current} / {restoreProgress.total}
              </div>
            </div>
          )}

          {restoreResult && (
            <div className={`mt-4 p-4 rounded-lg border-2 ${restoreResult.success
                ? 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700'
                : 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700'
              }`}>
              <div className="flex items-start gap-3">
                {restoreResult.success ? (
                  <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0" />
                ) : (
                  <XCircle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0" />
                )}
                <div>
                  <h4 className={`font-semibold mb-1 ${restoreResult.success ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'
                    }`}>
                    {restoreResult.success ? 'Restore Complete' : 'Restore Failed'}
                  </h4>
                  <p className={`text-sm whitespace-pre-line ${restoreResult.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                    }`}>
                    {restoreResult.message}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              <strong>Important:</strong>
            </p>
            <ul className="text-sm text-yellow-700 dark:text-yellow-400 mt-2 ml-4 list-disc">
              <li>The restore process will add data to your current account</li>
              <li>Duplicate facilities (same name and coordinates) will be skipped</li>
              <li>Photos will be re-uploaded to storage and linked to new inspections</li>
              <li>This may take several minutes for large backups</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border-2 border-red-200 dark:border-red-700">
        <h3 className="text-xl font-semibold text-red-700 dark:text-red-400 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          Danger Zone
        </h3>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          Permanently delete all facilities, inspections, and associated data. This action cannot be undone.
        </p>

        {!showClearAllWarning ? (
          <button
            onClick={() => setShowClearAllWarning(true)}
            disabled={facilities.length === 0}
            className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 className="w-5 h-5" />
            Clear All Data
          </button>
        ) : (
          <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-300 dark:border-red-700 rounded-lg p-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-red-800 dark:text-red-300 mb-2">
                  Are you absolutely sure?
                </h4>
                <p className="text-sm text-red-700 dark:text-red-400 mb-2">
                  This will permanently delete:
                </p>
                <ul className="text-sm text-red-700 dark:text-red-400 ml-4 list-disc mb-3">
                  <li>All {facilities.length} facilities</li>
                  <li>All inspection records and responses</li>
                  <li>All inspection photos</li>
                  <li>All saved route plans</li>
                </ul>
                <p className="text-sm font-semibold text-red-800 dark:text-red-300 bg-red-100 dark:bg-red-900/50 p-2 rounded">
                  ⚠️ RECOMMENDED: Export a backup first before deleting!
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleClearAllData}
                disabled={isClearing}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-red-400 transition-colors"
              >
                {isClearing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Yes, Delete Everything
                  </>
                )}
              </button>
              <button
                onClick={() => setShowClearAllWarning(false)}
                disabled={isClearing}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
