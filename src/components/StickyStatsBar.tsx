import { useEffect, useState, useRef } from 'react';
import { Calendar, MapPin, TrendingUp, Clock } from 'lucide-react';

interface StickyStatsBarProps {
  totalDays: number;
  totalFacilities: number;
  totalMiles: number;
  totalDriveTime: number;
  totalVisitTime: number;
  totalTime: number;
  triggerElementId: string;
}

export default function StickyStatsBar({
  totalDays,
  totalFacilities,
  totalMiles,
  totalDriveTime,
  totalVisitTime,
  totalTime,
  triggerElementId,
}: StickyStatsBarProps) {
  const [isVisible, setIsVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const triggerElement = document.getElementById(triggerElementId);
    if (!triggerElement) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setIsVisible(!entry.isIntersecting);
      },
      {
        threshold: 0,
        rootMargin: '-80px 0px 0px 0px',
      }
    );

    observerRef.current.observe(triggerElement);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [triggerElementId]);

  return (
    <div
      className={`fixed top-[105px] left-0 right-0 z-30 transition-all duration-300 pointer-events-none ${
        isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 px-4 py-2 pointer-events-auto transition-colors duration-200">
          <div className="flex items-center justify-around gap-4 text-xs sm:text-sm">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <div className="flex flex-col">
                <span className="font-semibold text-gray-900 dark:text-white">{totalDays} days</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {Math.floor(totalTime / 60)}h {Math.round(totalTime % 60)}m total
                </span>
              </div>
            </div>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="font-semibold text-gray-900 dark:text-white">{totalFacilities}</span>
              <span className="text-gray-600 dark:text-gray-300 hidden sm:inline">facilities</span>
            </div>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <span className="font-semibold text-gray-900 dark:text-white">{totalMiles.toFixed(1)}</span>
              <span className="text-gray-600 dark:text-gray-300 hidden sm:inline">mi</span>
            </div>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <div className="flex flex-col">
                <span className="font-semibold text-gray-900 dark:text-white">{Math.floor(totalDriveTime / 60)}h {Math.round(totalDriveTime % 60)}m</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">drive time</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
