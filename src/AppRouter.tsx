import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
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
import SPCCPlanViewerPage from './pages/SPCCPlanViewerPage';
import SPCCPlanDownloadPage from './pages/SPCCPlanDownloadPage';
import MobileSignaturePage from './pages/MobileSignaturePage';
import App from './App';
import LoadingScreen from './components/LoadingScreen';

const isNative = Capacitor.isNativePlatform();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Loading your account..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AgencyOwnerRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Verifying access..." />;
  }

  if (!user || !user.isAgencyOwner) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}

function RootRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Welcome back..." />;
  }

  if (!user) {
    // On native platforms, skip the landing page and go straight to login
    if (isNative) {
      return <Navigate to="/login" replace />;
    }
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
    return <LoadingScreen message="Signing in..." />;
  }

  if (user) {
    if (user.isAgencyOwner) {
      return <Navigate to="/agency" replace />;
    }
    return <Navigate to="/app" replace />;
  }

  // On native platforms, show only the login page without the landing page background
  if (isNative) {
    return <LoginPage />;
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
              <Route path="/spcc-plan/:facilityId" element={<SPCCPlanViewerPage />} />
              <Route
                path="/spcc-plan/:facilityId/berm/:bermIndex/download"
                element={<SPCCPlanDownloadPage />}
              />
              <Route path="/mobile-signature/:token" element={<MobileSignaturePage />} />
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
