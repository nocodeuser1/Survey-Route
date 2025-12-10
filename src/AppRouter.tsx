import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AccountProvider } from './contexts/AccountContext';
import { DarkModeProvider } from './contexts/DarkModeContext';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import SignupRequestPage from './pages/SignupRequestPage';
import AgencySignupPage from './pages/AgencySignupPage';
import AgencyDashboard from './pages/AgencyDashboard';
import AcceptInvitePage from './pages/AcceptInvitePage';
import SignatureSetupPage from './pages/SignatureSetupPage';
import UnsubscribePage from './pages/UnsubscribePage';
import App from './App';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AgencyOwnerRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !user.isAgencyOwner) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}

function RootRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  if (user.isAgencyOwner) {
    return <Navigate to="/agency" replace />;
  }

  return <Navigate to="/app" replace />;
}

function LoginRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    if (user.isAgencyOwner) {
      return <Navigate to="/agency" replace />;
    }
    return <Navigate to="/app" replace />;
  }

  return (
    <>
      <LandingPage />
      <LoginPage />
    </>
  );
}

function SignupRequestRoute() {
  return (
    <>
      <LandingPage />
      <SignupRequestPage />
    </>
  );
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AccountProvider>
          <DarkModeProvider>
            <Routes>
              <Route path="/" element={<RootRoute />} />
              <Route path="/login" element={<LoginRoute />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/request-access" element={<SignupRequestRoute />} />
              <Route path="/agency-signup" element={<AgencySignupPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
              <Route path="/unsubscribe" element={<UnsubscribePage />} />
              <Route
                path="/setup-signature"
                element={
                  <ProtectedRoute>
                    <SignatureSetupPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/agency"
                element={
                  <ProtectedRoute>
                    <AgencyOwnerRoute>
                      <AgencyDashboard />
                    </AgencyOwnerRoute>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app"
                element={
                  <ProtectedRoute>
                    <App />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </DarkModeProvider>
        </AccountProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
