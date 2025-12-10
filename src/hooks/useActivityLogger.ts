import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export type ActivityAction =
  | 'user_login'
  | 'tab_viewed'
  | 'facility_uploaded'
  | 'route_generated'
  | 'route_saved'
  | 'inspection_completed'
  | 'settings_updated'
  | 'team_member_added';

interface LogActivityParams {
  accountId: string;
  actionType: ActivityAction;
  tabViewed?: string;
  metadata?: Record<string, any>;
}

interface UseActivityLoggerReturn {
  logActivity: (params: LogActivityParams) => Promise<void>;
  logTabView: (accountId: string, tabName: string) => Promise<void>;
}

/**
 * Custom hook for logging user activity within accounts
 *
 * Features:
 * - Automatic user identification via auth context
 * - Debouncing for tab view events to prevent excessive logging
 * - Error handling to prevent logging failures from affecting app
 * - Captures user_id from authenticated session
 *
 * @returns Object with logActivity and logTabView functions
 */
export function useActivityLogger(): UseActivityLoggerReturn {
  const lastTabViewRef = useRef<{ tab: string; time: number } | null>(null);
  const DEBOUNCE_MS = 2000; // Don't log same tab view within 2 seconds

  /**
   * Logs a user activity to the database
   */
  const logActivity = useCallback(async ({
    accountId,
    actionType,
    tabViewed,
    metadata = {}
  }: LogActivityParams) => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        console.warn('Cannot log activity: No authenticated user');
        return;
      }

      // Insert activity log
      const { error } = await supabase
        .from('user_activity_logs')
        .insert({
          account_id: accountId,
          user_id: user.id,
          action_type: actionType,
          tab_viewed: tabViewed,
          metadata: metadata,
        });

      if (error) {
        console.error('Failed to log activity:', error);
      }
    } catch (error) {
      // Silently fail - logging should not break the app
      console.error('Activity logging error:', error);
    }
  }, []);

  /**
   * Logs a tab/view navigation event with debouncing
   * Prevents logging the same tab multiple times in quick succession
   */
  const logTabView = useCallback(async (accountId: string, tabName: string) => {
    // Debounce: Don't log same tab view within DEBOUNCE_MS
    const now = Date.now();
    const lastView = lastTabViewRef.current;

    if (lastView && lastView.tab === tabName && (now - lastView.time) < DEBOUNCE_MS) {
      return; // Skip logging
    }

    // Update last view
    lastTabViewRef.current = { tab: tabName, time: now };

    // Log the tab view
    await logActivity({
      accountId,
      actionType: 'tab_viewed',
      tabViewed: tabName,
      metadata: { timestamp: new Date().toISOString() }
    });
  }, [logActivity]);

  return {
    logActivity,
    logTabView,
  };
}
