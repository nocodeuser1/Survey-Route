import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const surveyModeSource = await readFile(new URL('../src/components/SurveyMode.tsx', import.meta.url), 'utf8');
const boundarySource = await readFile(new URL('../src/components/AppErrorBoundary.tsx', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const viteConfigSource = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

test('Survey Mode imports the completion icon it renders', () => {
  const lucideImport = surveyModeSource.match(/import \{([^}]+)\} from 'lucide-react';/)?.[1] ?? '';
  assert.match(lucideImport, /\bCheckCircle\b/);
  assert.match(surveyModeSource, /<CheckCircle className="h-2\.5 w-2\.5" \/>/);
});

test('changing Route Order immediately recomputes the visible facility list', () => {
  assert.match(
    surveyModeSource,
    /\[currentPosition, facilities, result, inspections, routeFacilityIds, showOffRoute, sortBy, teamNumber\]/,
  );
});

test('the app root renders a recovery screen instead of going blank', () => {
  assert.match(mainSource, /<AppErrorBoundary>/);
  assert.match(boundarySource, /Survey-Route needs to reopen/);
  assert.match(boundarySource, /surveyHub_surveyMode_/);
  assert.doesNotMatch(boundarySource, /localStorage\.clear\(/);
  assert.match(boundarySource, /does not remove inspections, drafts, photos, or routes/);
});

test('service-worker stamping cannot mask a failed production build', () => {
  assert.match(viteConfigSource, /async writeBundle\(\)/);
  assert.doesNotMatch(viteConfigSource, /async closeBundle\(\)/);
});
