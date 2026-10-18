import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
// This route never calls either public SPCC RPC. It resolves records with the
// signed-in user's RLS permissions and reveals a document only after that read.
export default function ConnectedSPCCPlan() {
  const { user, loading } = useAuth(),
    { facilityId } = useParams(),
    [params] = useSearchParams();
  const planId = params.get('plan');
  const [result, setResult] = useState<{ name: string; url: string | null } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!user) return;
    setResult(null);
    setError('');
    (async () => {
      try {
        const { data: f, error: fe } = await supabase
          .from('facilities')
          .select('id,name,spcc_plan_url')
          .eq('id', facilityId)
          .single();
        if (fe || !f) throw new Error();
        let url = f.spcc_plan_url;
        if (planId) {
          const { data: p, error: pe } = await supabase
            .from('spcc_plans')
            .select('plan_url')
            .eq('id', planId)
            .eq('facility_id', f.id)
            .single();
          if (pe || !p) throw new Error();
          url = p.plan_url;
        }
        // No arbitrary link targets and no new public/signed links.
        if (url) {
          const u = new URL(url);
          if (
            u.protocol !== 'https:' ||
            u.hostname !== 'rbjvcwgmqnubxixneitb.supabase.co' ||
            !u.pathname.startsWith('/storage/v1/object/') ||
            u.username ||
            u.password
          )
            throw new Error();
        }
        if (active) setResult({ name: f.name, url });
      } catch {
        if (active)
          setError('This plan is unavailable or your Survey Route account does not have access.');
      }
    })();
    return () => {
      active = false;
    };
  }, [user, facilityId, planId]);
  if (loading) return <p>Loading…</p>;
  if (!user)
    return (
      <Navigate
        replace
        to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
      />
    );
  return (
    <main className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">{result?.name || 'SPCC plan'}</h1>
      {error ? (
        <p role="alert">{error}</p>
      ) : !result ? (
        <p>Loading…</p>
      ) : result.url ? (
        <a
          className="inline-block bg-blue-600 text-white px-4 py-2 rounded"
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open existing plan
        </a>
      ) : (
        <p>No plan file is recorded.</p>
      )}
      <p>Access is checked using your signed-in Survey Route account.</p>
    </main>
  );
}
