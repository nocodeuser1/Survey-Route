# Survey Route — Native Build Plan (Capacitor)

## Overview
Wrap existing React+Vite app in Capacitor for iOS + Android with native features.
Key feature: **Hands-Free Inspection Mode** with voice-to-text + camera.

## Phase 1: Capacitor Setup (Foundation)
- `npx cap init` with bundle ID `com.beardata.surveyroute`
- `npx cap add ios` + `npx cap add android`
- `capacitor.config.ts` configuration
- Add `Capacitor.isNativePlatform()` checks (skip landing page on native)
- GitHub Actions CI workflows for iOS (macOS runner) + Android
- Verify build compiles and syncs: `npx cap sync`

## Phase 2: Hands-Free Inspection Mode (Core Feature)
- Full-screen hands-free UI with large stop button + camera icon
- Web Speech API for continuous voice recognition (SpeechRecognition)
- Real-time transcript display (scrolling, timestamped)
- Voice command detection: "take a picture", "next field", "done"
- Map current speech to inspection form fields using context matching
- Save transcript segments with timestamps for photo association

## Phase 3: Native Camera Integration
- Capacitor Camera plugin (`@capacitor/camera`)
- Voice-triggered capture: detect "take a picture" → auto-snap via native camera
- Fallback: camera icon button within hands-free UI
- Photo saved to device + uploaded to Supabase Storage
- Auto-caption from preceding 10-15 seconds of speech transcript
- Associate photo with correct inspection field based on speech context + timing

## Phase 4: Offline + Background Features
- Leverage existing offline-first sync (IndexedDB + service worker)
- Capacitor Filesystem plugin for native file caching
- Background audio processing (native keeps mic alive vs browser limits)
- Push notification setup (`@capacitor/push-notifications`)
- Haptic feedback on photo capture + voice command recognition

## Phase 5: Polish + Store Prep
- App icons + splash screens (both platforms)
- Privacy Policy URL needed on survey-route.com
- iOS: need distribution cert, provisioning profile, APNs key from Israel
- Android: signed AAB for Google Play
- Test on real devices before submission

## Capacitor Plugins Needed
- @capacitor/camera
- @capacitor/filesystem
- @capacitor/push-notifications
- @capacitor/haptics
- @capacitor/speech-recognition (or Web Speech API)
- @capacitor/preferences (key-value storage)

## Voice Command Mapping
| Command | Action |
|---------|--------|
| "take a picture" / "take photo" | Trigger native camera |
| "next field" / "next" | Move to next inspection field |
| "previous" / "go back" | Move to previous field |
| "done" / "finish" | End hands-free mode, save all data |
| "skip" | Skip current field |
| "add note" | Start capturing freeform note for current field |

## Photo Context Algorithm
1. Keep rolling buffer of last 30 seconds of transcript
2. On photo capture, snapshot the buffer
3. AI matches transcript keywords to inspection field names
4. Auto-assign photo to most likely field
5. Generate caption from relevant transcript segment
6. User can reassign in review mode after hands-free session ends
