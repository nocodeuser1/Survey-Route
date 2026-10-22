# Facility map focus regression

Base: `89cce7696f3c73b8d2a020e11ca79f241695ff69` (remote main verified before and after implementation).

## Root cause and scope

The facility-target effect moved the map, but the subsequent initial route redraw called `fitBounds` without checking the target. Reproduced against the unchanged component: selected latitude 42.12 was replaced by home-base latitude 39.7. Survey Mode additionally discarded its target after one second. The embedded map used an independent direct `setView` path.

All App handoffs now share one persistent target request. The map waits for readiness/layout, cancels obsolete animation frames and pending GPS/view-restoration requests, and gives the target priority over automatic initial bounds. New requests, including repeated requests for the same coordinates, stop the previous animation and fly to zoom 18. Reduced-motion requests use an immediate move. A temporary selected-location marker remains visible without changing completion, team, or route filters.

Fullscreen can now mount without a loaded route. The existing Show all facilities control reads the latest home base rather than its mount-time value. Facility detail reached from the map also provides the shared handoff.

## Verification

- `npm run build`: passed (existing bundle-size warnings).
- `JSDOM_MODULE=/tmp/survey-route-test-tools/node_modules/jsdom/lib/api.js node tests/routeMapLocation.integration.mjs`: 28/28 passed.
- Original regression failed before implementation, passed afterward.
- Coverage includes initial target with route, no route/home base, repeated target, rapid facility switches, redraws, selected-marker cleanup, interrupted mount/reopen, delayed home base, stale GPS cancellation, and all previous location tests.
- The harness executes the real NavigationPopup button and the actual shared callback extracted from App.tsx, and checks that all App onShowOnMap bindings use it. It does not mount the authenticated entire App or access production services.
- `npm run typecheck`: fails with the same 120 pre-existing diagnostics, identical after normalizing line numbers.
- `npm run lint`: fails with 487 pre-existing errors and 93 warnings; baseline was 487 errors and 94 warnings.
- `git diff --check`: passed.

## Visual QA limitation

The real-Leaflet mobile browser regression script now includes selected-facility checks at 390px and 320px: initial mount, world/street zoom, repeat clicks, rapid switch, and redraw. These new browser cases were **not executed successfully** here. Chromium launch fails on runtime socket/ptrace restrictions; the supported cloud browser blocks the local preview URL with `ERR_BLOCKED_BY_CLIENT`. No claim of live production, physical-phone, or real-browser visual verification is made.

To rerun in a browser-capable environment:

```
PLAYWRIGHT_MODULE=/tmp/survey-route-test-tools/node_modules/playwright/index.mjs node tests/routeMapLocation.browser.mjs
```

No production data changes, remote push, or deployment were performed.
