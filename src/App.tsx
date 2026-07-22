import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { OfflineProvider } from "./context/Offline";
import { ToastProvider } from "./context/Toast";
import { AgentProvider } from "./context/Agent";
import { SeedProvider } from "./context/Seed";
import { ZohoProvider } from "./context/Zoho";
import { TimezoneProvider } from "./context/Timezone";
import { ThemeProvider } from "./context/Theme";
import { BreakProvider } from "./context/Break";
import { RuntimeProvider } from "./runtime";
import { Layout } from "./components/Layout";
import { OrbitLoader } from "./components/ui";
import Login from "./routes/Login";
import VerifyEmail from "./routes/VerifyEmail";
import ForgotPassword from "./routes/ForgotPassword";
import InviteAccept from "./routes/InviteAccept";
import OAuthCallback from "./routes/OAuthCallback";
import Landing from "./routes/Landing";
import type { JSX } from "react";

// Everything behind the authenticated Layout is lazy — these are the routes
// that actually carry the app's weight (SchemaDiagram, CommitGraph, Zoho
// boards, etc.), unlike the small pre-auth pages above (the first thing any
// visitor loads, kept eager on purpose — no benefit to an extra round-trip
// before the very first paint).
const AiMode = lazy(() => import("./routes/AiMode"));
const Dashboard = lazy(() => import("./routes/Dashboard"));
const Projects = lazy(() => import("./routes/Projects"));
const ProjectDetail = lazy(() => import("./routes/ProjectDetail"));
const Teams = lazy(() => import("./routes/Teams"));
const Tickets = lazy(() => import("./routes/Tickets"));
const Sprints = lazy(() => import("./routes/Sprints"));
const Tasks = lazy(() => import("./routes/Tasks"));
const Docker = lazy(() => import("./routes/Docker"));
const Postgres = lazy(() => import("./routes/Postgres"));
const Mail = lazy(() => import("./routes/Mail"));
const Calendar = lazy(() => import("./routes/Calendar"));
const Notifications = lazy(() => import("./routes/Notifications"));
const TimeTracking = lazy(() => import("./routes/TimeTracking"));
const Docs = lazy(() => import("./routes/Docs"));
const Settings = lazy(() => import("./routes/Settings"));
const GetStarted = lazy(() => import("./routes/GetStarted"));
const Onboarding = lazy(() => import("./routes/Onboarding"));
const AuditLog = lazy(() => import("./routes/AuditLog"));
const Automation = lazy(() => import("./routes/Automation"));
const Health = lazy(() => import("./routes/Health"));
const Insights = lazy(() => import("./routes/Insights"));
const Intelligence = lazy(() => import("./routes/Intelligence"));

function RouteLoader() {
  return <div className="page-loader"><OrbitLoader label="Loading…" /></div>;
}

function Guard({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-load">Loading ORBIT…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <OfflineProvider>
      <ThemeProvider>
      <ToastProvider>
        <AgentProvider>
          <SeedProvider>
          <ZohoProvider>
          <TimezoneProvider>
          <BreakProvider>
          <BrowserRouter>
          <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/verify" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route element={<Guard><RuntimeProvider><Layout /></RuntimeProvider></Guard>}>
              <Route path="/get-started" element={<GetStarted />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/app" element={<Dashboard />} />
              <Route path="/ai-mode" element={<AiMode />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/teams" element={<Teams />} />
              <Route path="/tickets" element={<Tickets />} />
              <Route path="/sprints" element={<Sprints />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/docker" element={<Docker />} />
              <Route path="/postgres" element={<Postgres />} />
              <Route path="/mail" element={<Mail />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/time" element={<TimeTracking />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/automation" element={<Automation />} />
              <Route path="/health" element={<Health />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/intelligence" element={<Intelligence />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </BrowserRouter>
          </BreakProvider>
          </TimezoneProvider>
          </ZohoProvider>
          </SeedProvider>
        </AgentProvider>
      </ToastProvider>
      </ThemeProvider>
      </OfflineProvider>
    </AuthProvider>
  );
}
