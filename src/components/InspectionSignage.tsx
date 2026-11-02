import { useEffect, useId, useRef, useState } from 'react';
import { supabase, InspectionPhoto } from '../lib/supabase';
import { FACILITY_SIGNAGE_QUESTION_ID, getFacilitySignagePhoto } from '../utils/inspectionSignage';

// Normalize camera images to a bounded, metadata-free JPEG for offline HTML/PDF.
async function prepareSignageImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the photo. Please try again.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not read the photo.')), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

/** Independent photo-only writes: never saves/reopens the inspection or its responses. */
export default function InspectionSignage({ inspectionId, canEdit = false }: { inspectionId?: string; canEdit?: boolean }) {
  const inputId = useId();
  const [photo, setPhoto] = useState<InspectionPhoto | null>(null);
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const cancelled = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    setPhoto(null); setUrl(''); setLoaded(false); setError(''); setPending(null); setPhase(''); setMessage(''); busy.current = false;
    if (!inspectionId) { setLoaded(true); return; }
    void (async () => {
      try {
        const { data, error: readError } = await supabase.from('inspection_photos').select('*').eq('inspection_id', inspectionId).eq('question_id', FACILITY_SIGNAGE_QUESTION_ID);
        if (readError) throw readError;
        if (generation.current !== current) return;
        setPhoto(getFacilitySignagePhoto(data || []) ?? null); setLoaded(true);
      } catch { if (generation.current === current) setError('Could not load signage. Reopen this inspection to retry.'); }
    })();
    return () => { generation.current = current + 1; cancelled.current = true; };
  }, [inspectionId]);

  useEffect(() => {
    let active = true;
    setUrl('');
    if (photo) void supabase.storage.from('inspection-photos').createSignedUrl(photo.photo_url, 3600).then(({ data, error: signError }) => {
      if (active && !signError && data) setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [photo]);

  useEffect(() => {
    if (!pending) { setPreview(''); return; }
    const objectUrl = URL.createObjectURL(pending); setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [pending]);

  useEffect(() => {
    if (!canEdit) { cancelled.current = true; setPending(null); }
  }, [canEdit]);

  const upload = async () => {
    if (!canEdit || !inspectionId || !pending || busy.current) return;
    busy.current = true; cancelled.current = false;
    const current = generation.current;
    const oldPhoto = photo;
    let path: string | undefined;
    let committed = false;
    let saving = false;
    setError(''); setMessage(''); setPhase('Preparing photo…');
    try {
      const blob = await prepareSignageImage(pending);
      if (cancelled.current || generation.current !== current) return;
      path = `${inspectionId}/${FACILITY_SIGNAGE_QUESTION_ID}/${crypto.randomUUID()}.jpg`;
      setPhase('Uploading signage…');
      const { error: uploadError } = await supabase.storage.from('inspection-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw uploadError;
      if (cancelled.current || generation.current !== current) return;
      // Cancellation is offered until the commit begins. Afterwards the row may
      // have committed even if a connection drops; reload rather than deleting it.
      setPhase('Saving signage…');
      saving = true;
      const { data, error: insertError } = await supabase.from('inspection_photos').insert({ inspection_id: inspectionId, question_id: FACILITY_SIGNAGE_QUESTION_ID, photo_url: path, file_name: 'facility-signage.jpg', file_size: blob.size }).select().single();
      if (insertError) { path = undefined; throw insertError; }
      committed = true;
      if (generation.current === current) { setPhoto(data); setPending(null); setMessage('Signage saved.'); }
      // Never remove the old image before its replacement has committed.
      if (oldPhoto) {
        try {
        const { data: deleted, error: deleteError } = await supabase.from('inspection_photos').delete().eq('id', oldPhoto.id).eq('inspection_id', inspectionId).select('id');
        if (!deleteError && deleted?.length) await supabase.storage.from('inspection-photos').remove([oldPhoto.photo_url]);
        } catch { /* Replacement is saved; obsolete-photo cleanup is best effort. */ }
      }
    } catch {
      if (generation.current === current) setError(saving ? 'The save could not be confirmed. Reopen the inspection to check before retrying.' : 'Signage could not be uploaded. Your existing photo is unchanged. Please retry.');
    } finally {
      if (path && !committed && !saving) await supabase.storage.from('inspection-photos').remove([path]).catch(() => {});
      if (generation.current === current) { busy.current = false; setPhase(''); }
    }
  };

  if (!canEdit && !url) return null;
  return <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 mb-4" aria-label="Facility signage">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">Facility signage{canEdit ? ' (optional)' : ''}</h3>
      {canEdit && <label htmlFor={inputId} className={`inline-flex min-h-11 items-center rounded border px-3 text-sm ${phase || !inspectionId || !loaded ? 'opacity-50' : 'cursor-pointer hover:bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500'}`}>
        {photo ? 'Replace signage' : 'Upload signage'}
        <input id={inputId} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={!!phase || !inspectionId || !loaded} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          setError(''); setMessage('');
          if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024) { setError('Choose a JPEG, PNG or WebP photo smaller than 20 MB.'); return; }
          setPending(file);
        }} />
      </label>}
    </div>
    {(preview || url) && <img key={preview || url} src={preview || url} alt="Facility signage" className="mt-3 max-h-36 max-w-[220px] w-auto object-contain" onError={event => { event.currentTarget.style.display = 'none'; }} />}
    {canEdit && !inspectionId && <p className="mt-2 text-xs text-gray-500">Save a draft to add signage.</p>}
    {canEdit && pending && <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={!!phase} onClick={upload} className="min-h-11 rounded bg-blue-600 px-3 text-sm text-white disabled:opacity-50">{error ? 'Retry upload' : 'Save signage'}</button>
      <button type="button" disabled={phase === 'Saving signage…'} onClick={() => { cancelled.current = true; setPending(null); setError(''); }} className="min-h-11 rounded border px-3 text-sm disabled:opacity-50">Cancel</button>
    </div>}
    <p role="status" aria-live="polite" className="text-sm text-gray-600 mt-1">{phase || message}</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </section>;
}
