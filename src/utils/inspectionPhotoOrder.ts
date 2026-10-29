export function photoCreatedAtForBatch(batchStartedAt: number, pickerIndex: number): string {
  return new Date(batchStartedAt - pickerIndex).toISOString();
}

export function prependPhotoBatch<T>(existingPhotos: T[], uploadedBatch: T[]): T[] {
  return [...uploadedBatch, ...existingPhotos];
}
