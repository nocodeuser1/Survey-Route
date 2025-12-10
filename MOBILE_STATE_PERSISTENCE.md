# Mobile Safari State Persistence Solution

## Problem
When testing on mobile Safari (iOS), switching to another app (like Messages) or another browser tab would cause the SurveyHub app to reset completely. When returning to Safari:
- The app would scroll back to the top
- Expanded day sections would collapse
- Selected facilities would be deselected
- The active tab would sometimes change
- Filter and search settings would reset

This happened because Safari on iOS aggressively manages memory and may discard background tabs to free up resources, causing the page to reload when you return.

## Solution Overview
We implemented a comprehensive state persistence system using `localStorage` instead of `sessionStorage`, along with iOS Safari-specific lifecycle event handlers to preserve and restore the application state seamlessly.

## Key Changes

### 1. State Persistence Utility (`src/utils/statePersistence.ts`)
Created a centralized state management utility that:
- Uses `localStorage` for persistent storage across page reloads
- Implements debouncing to reduce excessive storage writes
- Provides type-safe get/set/remove operations
- Includes scroll position tracking and restoration
- Handles cleanup automatically

**Key Features:**
- Automatic state serialization/deserialization
- Debounced writes for performance
- Error handling for storage quota issues
- Namespaced keys to avoid conflicts

### 2. SurveyMode Component Updates
Enhanced the SurveyMode component with:

**State Persistence:**
- Filter selection (all/incomplete/completed/expired)
- Search query text
- Sort preference (distance/name/status)
- Selected facility ID
- Expanded facility ID
- Scroll position in the facility list

**iOS Safari Lifecycle Handlers:**
- `visibilitychange` - Detects when tab becomes visible/hidden
- `pagehide` - Saves state before page unloads (iOS specific)
- `pageshow` - Restores state when page shows from cache
- Automatic scroll position restoration after data loads

**Improvements:**
- Replaced all `sessionStorage` with `localStorage` via the persistence utility
- Added scroll container with proper overflow handling
- Implemented delayed state restoration to allow DOM to render
- Added cleanup on component unmount

### 3. App.tsx Component Updates
Enhanced the main App component with:

**Smart Data Reloading:**
- Tracks last data load time to prevent excessive reloads
- Only reloads if more than 5 seconds since last load
- Handles iOS Safari's back-forward cache (bfcache)

**Lifecycle Event Handlers:**
- `visibilitychange` with time-based throttling
- `pageshow` for bfcache restoration
- `beforeunload` to save current view state

**Benefits:**
- Prevents unnecessary data fetches
- Maintains route planning state
- Preserves optimization results
- Reduces server load and improves performance

## How It Works

### When You Switch Apps:
1. **pagehide** event fires (iOS Safari)
2. Current state is immediately saved to localStorage:
   - Current view (facilities/route-planning/survey/settings)
   - Selected facility
   - Expanded facility
   - Filter settings
   - Search query
   - Scroll position

### When You Return:
1. **pageshow** or **visibilitychange** event fires
2. State is restored from localStorage
3. Data is reloaded (if needed) based on time threshold
4. Scroll position is restored after DOM renders
5. UI reflects your exact previous state

### State Persistence Flow:
```
User Interaction → State Change → Debounced Save to localStorage
                                           ↓
                                    Persistent Storage
                                           ↓
Page Reload/Restore ← Load from localStorage ← Event Handler
```

## Testing on iOS Safari

To verify the fixes work:

1. **Open the SurveyHub app** in Safari on iOS
2. **Navigate to Survey Mode**
3. **Scroll down** to a facility in the middle of the list
4. **Expand a facility** to see its inspection history
5. **Apply some filters** (e.g., show only "Pending" facilities)
6. **Switch to Messages** or another app
7. **Wait 10-15 seconds** (allow Safari to potentially unload the page)
8. **Switch back to Safari**

**Expected Result:**
- The app should be at the same scroll position
- The same facility should still be expanded
- Your filters should still be applied
- The same tab should be active

## Technical Details

### localStorage vs sessionStorage
- **sessionStorage**: Cleared when tab is closed or page is reloaded by Safari's memory management
- **localStorage**: Persists until explicitly cleared, survives page reloads and background tab unloading

### Debouncing
Search query updates are debounced (300ms) to avoid excessive writes to localStorage during typing.

### Scroll Restoration Timing
Scroll position restoration is delayed by 100-300ms to ensure:
1. React has finished rendering
2. The DOM is fully populated
3. The container has its final dimensions
4. Data has been loaded from the server

### Event Handler Priority
1. **pagehide** - Highest priority, fires before page unloads
2. **pageshow** - Detects cache restoration
3. **visibilitychange** - Handles tab switching
4. **beforeunload** - Fallback for older browsers

## Performance Considerations

### Optimizations:
- Debounced writes reduce localStorage operations
- Time-based throttling prevents unnecessary data reloads
- Passive scroll event listeners improve scroll performance
- requestAnimationFrame ensures smooth scroll restoration

### Memory Management:
- Cleanup functions clear all timers and event listeners
- State persistence manager tracks and cancels pending operations
- Automatic cleanup on component unmount

## Browser Compatibility

**Fully Supported:**
- iOS Safari 12+
- Safari on macOS
- Chrome on iOS (uses Safari engine)
- Modern mobile browsers

**Graceful Degradation:**
- Falls back to default behavior if localStorage is not available
- Error handling prevents crashes if storage quota is exceeded

## Maintenance Notes

### Adding New Persisted State:
1. Use `statePersistence.set()` to save state
2. Initialize state with `statePersistence.get()` with a default value
3. Clean up state on unmount if needed

### Example:
```typescript
const [myState, setMyState] = useState(() => {
  return statePersistence.get<string>('myState', 'defaultValue') ?? 'defaultValue';
});

useEffect(() => {
  statePersistence.set('myState', myState);
}, [myState]);
```

## Known Limitations

1. **Storage Quota**: localStorage has a ~5-10MB limit per domain. The app uses minimal storage, but be mindful when adding more persisted state.

2. **Private Browsing**: Some browsers restrict localStorage in private mode. The app handles this gracefully with try-catch blocks.

3. **Cross-Device**: State is not synchronized across devices. Each device maintains its own local state.

## Future Enhancements

Potential improvements for even better UX:
- Sync state to Supabase for cross-device persistence
- Add state versioning for migration support
- Implement state compression for large data sets
- Add visual indicators when state is being restored
- Implement offline support with service workers

## Summary

The mobile Safari state persistence solution ensures that users can seamlessly switch between apps without losing their place in the SurveyHub application. By leveraging localStorage, iOS-specific lifecycle events, and smart state restoration logic, the app now maintains its complete state across app switches, tab changes, and even page reloads.
