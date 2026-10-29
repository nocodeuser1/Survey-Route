import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routeMap = await readFile(new URL('../src/components/RouteMap.tsx', import.meta.url), 'utf8');
const detailModal = await readFile(new URL('../src/components/FacilityDetailModal.tsx', import.meta.url), 'utf8');
const history = await readFile(new URL('../src/components/FacilityInspectionsManager.tsx', import.meta.url), 'utf8');

test('inspection-mode marker popups provide a direct inspection action and separate history', () => {
  assert.match(routeMap, /surveyBtnLabel = currentDraft \? 'Continue Inspection' : 'Add Inspection'/);
  assert.match(routeMap, /View Inspection History \(\$\{facilityInspections\.length\}\)/);
  assert.match(routeMap, /openInspectionForm\(facilityForThisMarker, \{ initialDraft: currentDraft \|\| null \}\)/);
  assert.match(routeMap, /openInspectionForm\(facility, \{ initialDraft: currentDraft \|\| null \}\)/);
});

test('history actions hand off to one top-level inspection form instead of reopening details', () => {
  assert.match(routeMap, /onAddNewInspection=\{\(\) => \{\s*openInspectionForm\(inspectionsListFacility\)/);
  assert.match(routeMap, /<ModalPortal>\s*<InspectionForm/);
  assert.match(history, />\s*Add Inspection\s*</);
});

test('facility-details inspection form is portaled above its details sheet', () => {
  assert.match(detailModal, /if \(showInspectionForm\) \{\s*return createPortal\(/);
  assert.match(detailModal, /<InspectionForm[\s\S]*document\.body,/);
});
