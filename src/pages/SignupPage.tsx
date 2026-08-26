import { Navigate, useLocation } from 'react-router-dom';

/**
 * Legacy invitation links used /signup?token=.... Keep them working, but route
 * every invitation through the single tenant-scoped acceptance workflow.
 */
export default function SignupPage() {
  const location = useLocation();
  return <Navigate to={`/accept-invite${location.search}`} replace />;
}
