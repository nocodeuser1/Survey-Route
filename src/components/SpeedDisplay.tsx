import { Gauge } from 'lucide-react';

interface SpeedDisplayProps {
  speed: number | null;
  speedUnit: 'mph' | 'kmh';
  estimatedSpeedLimit?: number | null;
  isNavigationMode: boolean;
}

export default function SpeedDisplay({
  speed,
  speedUnit,
  estimatedSpeedLimit,
  isNavigationMode
}: SpeedDisplayProps) {
  if (!isNavigationMode) return null;

  const displaySpeed = speed !== null ? Math.round(speed) : '--';
  const unitLabel = speedUnit === 'mph' ? 'MPH' : 'KM/H';

  const isOverSpeedLimit = estimatedSpeedLimit && speed && speed > estimatedSpeedLimit;

  return (
    <div className="fixed left-4 bottom-24 z-[1000] flex flex-col gap-2">
      {speed === null && (
        <div className="bg-yellow-50 rounded-lg shadow-lg border-2 border-yellow-300 px-3 py-2 flex items-center justify-center">
          <span className="text-sm font-semibold text-yellow-700">No GPS Signal</span>
        </div>
      )}

      <div
        className={`bg-white rounded-full shadow-xl border-4 ${
          isOverSpeedLimit ? 'border-red-500' : 'border-gray-300'
        } w-24 h-24 flex flex-col items-center justify-center transition-all duration-300`}
      >
        <div className="flex items-baseline gap-0.5">
          <span
            className={`text-3xl font-bold ${
              isOverSpeedLimit ? 'text-red-600' : 'text-gray-800'
            }`}
          >
            {displaySpeed}
          </span>
        </div>
        <span className="text-xs font-semibold text-gray-600 mt-0.5">
          {unitLabel}
        </span>
      </div>

      {estimatedSpeedLimit !== null && estimatedSpeedLimit !== undefined && (
        <div className="bg-white rounded-lg shadow-lg border-2 border-gray-300 px-3 py-2 flex flex-col items-center">
          <div className="flex items-center gap-1">
            <Gauge className="w-3 h-3 text-gray-600" />
            <span className="text-xs font-medium text-gray-600">Est. Limit</span>
          </div>
          <span className="text-lg font-bold text-gray-800">
            {estimatedSpeedLimit}
          </span>
          <span className="text-xs text-gray-500">{unitLabel}</span>
        </div>
      )}
    </div>
  );
}
