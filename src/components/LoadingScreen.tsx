import { Route } from 'lucide-react';

interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 dark:from-gray-900 dark:via-slate-800 dark:to-gray-900 flex items-center justify-center p-4 relative overflow-hidden">
      <style>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-20px);
          }
        }

        @keyframes spin-slow {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        @keyframes spin-reverse {
          0% {
            transform: rotate(360deg);
          }
          100% {
            transform: rotate(0deg);
          }
        }

        @keyframes shimmer {
          0% {
            background-position: -1000px 0;
          }
          100% {
            background-position: 1000px 0;
          }
        }

        @keyframes gradient-shift {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }

        @keyframes slide {
          0% {
            transform: translateX(-8px);
            opacity: 0.5;
          }
          50% {
            transform: translateX(0);
            opacity: 1;
          }
          100% {
            transform: translateX(8px);
            opacity: 0.5;
          }
        }

        .animate-float {
          animation: float 6s ease-in-out infinite;
        }

        .animate-spin-slow {
          animation: spin-slow 3s linear infinite;
        }

        .animate-spin-reverse {
          animation: spin-reverse 2s linear infinite;
        }

        .animate-shimmer {
          background-size: 200% auto;
          animation: shimmer 3s linear infinite;
        }

        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient-shift 4s ease infinite;
        }

        .animate-slide {
          animation: slide 2s ease-in-out infinite;
        }
      `}</style>

      {/* Animated background orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-400/30 dark:bg-blue-600/20 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-400/30 dark:bg-blue-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/2 w-72 h-72 bg-blue-400/20 dark:bg-blue-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '4s' }}></div>
      </div>

      {/* Main loading card with glassmorphism */}
      <div className="relative">
        <div className="animate-float">
          {/* Glass card with enhanced backdrop blur */}
          <div className="relative backdrop-blur-2xl bg-white/60 dark:bg-gray-800/60 rounded-3xl shadow-2xl border border-white/70 dark:border-gray-700/70 p-12 min-w-[340px]">
            {/* Animated gradient border glow */}
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 opacity-30 blur-2xl animate-gradient"></div>

            {/* Inner shadow for depth */}
            <div className="absolute inset-0 rounded-3xl shadow-inner"></div>

            {/* Content container */}
            <div className="relative z-10 flex flex-col items-center gap-8">
              {/* Spinner system */}
              <div className="relative w-32 h-32">
                {/* Outer ring */}
                <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-blue-600 border-r-blue-500/70 animate-spin opacity-80"></div>

                {/* Center Route icon - 2x the original circle size */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Route className="w-12 h-12 text-blue-600 dark:text-blue-400" strokeWidth={2} />
                </div>

                {/* Radial glow effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-400/30 via-blue-400/30 to-transparent rounded-full blur-2xl animate-pulse"></div>
              </div>

              {/* Loading text with static gradient */}
              <div className="text-center space-y-3">
                <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-500 dark:from-blue-400 dark:to-blue-300 bg-clip-text text-transparent">
                  {message}
                </h3>

                {/* Animated dots */}
                <div className="flex gap-2 justify-center">
                  <div className="w-2.5 h-2.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-slide shadow-lg" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2.5 h-2.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-slide shadow-lg" style={{ animationDelay: '200ms' }}></div>
                  <div className="w-2.5 h-2.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-slide shadow-lg" style={{ animationDelay: '400ms' }}></div>
                </div>
              </div>

              {/* Brand section */}
              <div className="text-center pt-2 border-t border-gray-200/50 dark:border-gray-700/50 w-full">
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 tracking-tight">Survey-Route</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">by BEAR DATA</p>
              </div>
            </div>

            {/* Shine effect overlay */}
            <div className="absolute inset-0 rounded-3xl overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] animate-shimmer"></div>
            </div>
          </div>
        </div>

        {/* Reflection effect at bottom */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-3/4 h-24 bg-gradient-to-b from-white/20 dark:from-gray-800/20 to-transparent blur-xl opacity-40 transform scale-y-[-1]"></div>
      </div>
    </div>
  );
}
