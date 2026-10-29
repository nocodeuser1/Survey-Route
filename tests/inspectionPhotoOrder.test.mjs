import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  photoCreatedAtForBatch,
  prependPhotoBatch,
} from '../src/utils/inspectionPhotoOrder.ts';

const inspectionFormSource = await readFile(
  new URL('../src/components/InspectionForm.tsx', import.meta.url),
  'utf8',
);

test('a later photo batch displays before older photos without reversing picker order', () => {
  assert.deepEqual(
    prependPhotoBatch(['1', '2', '3'], ['4', '5']),
    ['4', '5', '1', '2', '3'],
  );
});

test('database timestamps preserve picker order inside each batch', () => {
  const first = Date.parse(photoCreatedAtForBatch(1_000, 0));
  const second = Date.parse(photoCreatedAtForBatch(1_000, 1));
  const third = Date.parse(photoCreatedAtForBatch(1_000, 2));

  assert.ok(first > second);
  assert.ok(second > third);
});

test('every photo in a later batch sorts ahead of an earlier batch', () => {
  const laterBatchLastPhoto = Date.parse(photoCreatedAtForBatch(2_000, 2));
  const earlierBatchFirstPhoto = Date.parse(photoCreatedAtForBatch(1_000, 0));

  assert.ok(laterBatchLastPhoto > earlierBatchFirstPhoto);
});

test('the inspection form persists and reloads the stable photo order', () => {
  assert.match(inspectionFormSource, /created_at: photoCreatedAtForBatch\(batchStartedAt, i\)/);
  assert.match(inspectionFormSource, /photos: prependPhotoBatch\(r\.photos \|\| \[\], uploadedPhotos\)/);
  assert.match(inspectionFormSource, /\.order\('created_at', \{ ascending: false \}\)/);
});
