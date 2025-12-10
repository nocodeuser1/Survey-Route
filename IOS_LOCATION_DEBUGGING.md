# iOS Safari Location Debugging Guide

## Changes Made

### 1. Initial Location Check on Component Mount
- The app now automatically checks location status when the Survey Mode loads
- Uses a silent check with `maximumAge: 60000` to see if permission was previously granted
- If granted, automatically starts tracking without showing prompts

### 2. Improved Error Handling
- Clear error codes (1, 2, 3) mapped to specific user-friendly messages
- Better timeout handling (15 seconds instead of 20)
- Console logging added for debugging

### 3. Enhanced UI Status Display
- Shows current permission state: unknown, prompt, granted, denied
- Better visual feedback during different stages
- Separate alerts for different scenarios

## How to Debug on Your iPhone

### Step 1: Open Safari DevTools (on Mac)
1. On your iPhone: Settings > Safari > Advanced > Web Inspector (turn ON)
2. Connect iPhone to Mac via USB
3. On Mac: Safari > Develop > [Your iPhone] > [Your Site]
4. Open the Console tab

### Step 2: Check Console Logs
When you click "Enable Location Access" button, you should see:
```
Requesting location permission - button clicked
User agent: Mozilla/5.0 (iPhone; CPU iPhone OS...)
Is HTTPS: true
```

Then one of:
- **SUCCESS**: `Location permission SUCCESS: [lat] [lng]`
- **ERROR**: `Location permission ERROR: [code] [message]`

### Step 3: Check iOS Settings

#### Safari Location Setting
1. Settings > Safari > Location
2. Should be set to "Ask" or "Allow"
3. NOT "Deny"

#### System Location Services
1. Settings > Privacy & Security > Location Services
2. Must be ON (green toggle at top)
3. Scroll down to Safari
4. Should be "While Using the App" or "Ask Next Time"

### Step 4: Check for Known Issues

#### Issue: Permission Already Granted but App Doesn't Know
**Symptom**: iOS says location is allowed, but app still shows "Enable Location" button

**Console will show**:
- On mount: `Initial location check SUCCESS` followed by coordinates
- Permission state will be 'granted'
- Location tracking will start automatically

**If you see this**: The app SHOULD automatically work. If not, check:
1. Is the green "Location: Xm accuracy" indicator showing?
2. Are facilities sorted by distance?

#### Issue: Error Code 1 (PERMISSION_DENIED)
**Symptom**: Click button, no popup, error shows

**Console shows**: `PERMISSION_DENIED - User or system denied permission`

**Solution**:
1. Settings > Safari > Location > set to "Ask"
2. Close Safari completely (swipe up from app switcher)
3. Reopen Safari and try again

#### Issue: Error Code 2 (POSITION_UNAVAILABLE)
**Symptom**: Permission granted but can't get location

**Console shows**: `POSITION_UNAVAILABLE - Cannot determine position`

**Solution**:
1. Check System Location Services is ON
2. Try outdoors or near window
3. Wait 10-15 seconds for GPS signal
4. Restart iPhone if problem persists

#### Issue: Error Code 3 (TIMEOUT)
**Symptom**: Takes too long, times out after 15 seconds

**Console shows**: `TIMEOUT - Location request took too long`

**Solution**:
1. Move to location with better GPS reception
2. Check that Location Services system-wide is ON
3. Try restarting Location Services toggle

### Step 5: Force Reset Safari Permissions

If nothing works:

1. Settings > Safari > Clear History and Website Data
2. This will reset ALL permissions for ALL websites
3. Reopen your site
4. Try location access again - you should get a fresh prompt

### Step 6: Check HTTPS

The console log shows `Is HTTPS: true` or `false`

**iOS Safari requires HTTPS for geolocation!**

If you see `false`:
- Location will NOT work on iOS
- Must access via https:// URL
- Local development may need ngrok or similar

## Expected Behavior

### First Visit (Permission Not Granted)
1. Component mounts
2. Console: "Initial location check ERROR: 1"
3. Shows orange "Location Access Needed" button
4. Click button
5. iOS shows native location permission popup
6. User taps "Allow"
7. Location starts working immediately

### Returning Visit (Permission Already Granted)
1. Component mounts
2. Console: "Initial location check SUCCESS"
3. No prompts shown
4. Location automatically starts tracking
5. Facilities sorted by distance
6. Green indicator shows accuracy

### Permission Previously Denied
1. Component mounts
2. Console: "Initial location check ERROR: 1"
3. Shows error message with instructions
4. User must manually fix in iOS Settings
5. After fixing, refresh page or click "Try Again"

## Common iOS Safari Quirks

1. **Permission popup only shows ONCE per site** - If denied, must fix in Settings
2. **Requires user gesture** - Can't auto-request on page load
3. **HTTPS only** - Will silently fail on http://
4. **Tab backgrounding** - May pause location when tab not active
5. **Private Browsing** - May block location entirely
6. **Content Blockers** - May interfere with geolocation API

## What to Look For in Console

### Good Signs:
- "Checking initial location status..."
- "Initial location check SUCCESS:" with coordinates
- Permission state transitions: unknown → prompt → granted
- "Location permission SUCCESS:" when clicking button

### Bad Signs:
- "Initial location check ERROR: 1" (permission denied)
- "Is HTTPS: false" (not using secure connection)
- No console logs at all (JavaScript error elsewhere)
- Error code 2 repeatedly (Location Services system-wide is OFF)

## Next Steps if Still Not Working

Send the following info:
1. Full console log from clicking "Enable Location Access"
2. Screenshot of Settings > Safari > Location
3. Screenshot of Settings > Privacy & Security > Location Services > Safari
4. iOS version
5. Is it HTTPS or HTTP?
6. Does it work in Chrome on same iPhone?
