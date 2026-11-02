import assert from 'node:assert/strict';
import test from 'node:test';
import { FACILITY_SIGNAGE_QUESTION_ID, getFacilitySignagePhoto, renderFacilitySignageHtml, reportPhotosWithLatestSignage } from '../src/utils/inspectionSignage.ts';
const photo = (id, date = '2026-11-02T12:34:56Z') => ({ id, created_at: date, question_id: FACILITY_SIGNAGE_QUESTION_ID, photo_url: 'https://example.test/photo.png' });
test('latest signage selection is deterministic without mutating caller array', () => {
  const rows = [photo('a'), photo('c', '2026-11-01T12:34:56Z'), photo('b')];
  assert.equal(getFacilitySignagePhoto(rows).id, 'b');
  assert.deepEqual(rows.map(p => p.id), ['a', 'c', 'b']);
  assert.equal(getFacilitySignagePhoto([{ ...photo('other'), question_id: 'q1' }]), undefined);
});
test('absent, failed or unsafe image has no section, label or placeholder', () => {
  for (const photos of [[], [{ ...photo('a'), photo_url: '' }], [{ ...photo('a'), photo_url: 'javascript:alert(1)' }], [{ ...photo('a'), photo_url: 'data:image/svg+xml,<svg/>' }], [{ ...photo('a'), photo_url: 'i1/__facility_signage__/file.jpg' }]]) assert.equal(renderFacilitySignageHtml(photos), '');
});
test('signage markup safely escapes source and never shows upload date/name', () => {
  const html = renderFacilitySignageHtml([{ ...photo('a'), photo_url: 'https://example.test/a?x="&y=2' }]);
  assert.match(html, /x=&quot;&amp;y=2/);
  assert.doesNotMatch(html, /2026-11-02|12:34:56|created_at/);
  assert.equal((html.match(/<img /g) || []).length, 1);
});
test('each inspection selects its latest attachment before download, without old-image fallback', () => {
  const rows = [
    { ...photo('old', '2026-11-01'), inspection_id: 'i1' },
    { ...photo('new'), inspection_id: 'i1', photo_url: 'broken/storage/path' },
    { ...photo('other'), inspection_id: 'i2' },
    { ...photo('answer'), question_id: 'q1', inspection_id: 'i1' },
  ];
  assert.deepEqual(reportPhotosWithLatestSignage(rows).map(p => p.id), ['new', 'other', 'answer']);
  const loaded = reportPhotosWithLatestSignage(rows).filter(p => p.id !== 'new');
  assert.equal(renderFacilitySignageHtml(loaded.filter(p => p.inspection_id === 'i1')), '');
});
