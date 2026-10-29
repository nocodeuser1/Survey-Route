import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

const SURVEY_MODE_STATE_PREFIX = 'surveyHub_surveyMode_';

export default class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] Survey-Route render failed', error, info);
  }

  private reload = (): void => {
    window.location.reload();
  };

  private resetScreenState = (): void => {
    try {
      const keysToRemove: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(SURVEY_MODE_STATE_PREFIX)) keysToRemove.push(key);
      }
      keysToRemove.forEach(key => window.localStorage.removeItem(key));
      window.localStorage.removeItem('currentView');
    } catch (error) {
      console.warn('[AppErrorBoundary] Could not reset saved screen state', error);
    }
    window.location.assign('/?recovered=screen-state');
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-[100dvh] bg-gray-50 px-5 py-10 text-gray-900 dark:bg-gray-950 dark:text-white">
        <section className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold">Survey-Route needs to reopen</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
            The current screen stopped unexpectedly. Your saved inspections and account data are safe.
          </p>
          <div className="mt-7 grid w-full gap-3">
            <button
              type="button"
              onClick={this.reload}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-5 w-5" />
              Reload app
            </button>
            <button
              type="button"
              onClick={this.resetScreenState}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 font-semibold text-gray-800 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800"
            >
              <RotateCcw className="h-5 w-5" />
              Reset this screen
            </button>
          </div>
          <p className="mt-4 text-xs leading-5 text-gray-500 dark:text-gray-400">
            Reset this screen only clears Survey Mode display choices. It does not remove inspections, drafts, photos, or routes.
          </p>
        </section>
      </main>
    );
  }
}
