import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/Toast";
import { AgentProvider } from "./context/Agent";
import { ZohoProvider } from "./context/Zoho";
import { TimezoneProvider } from "./context/Timezone";
import { BreakProvider } from "./context/Break";
import { Layout } from "./components/Layout";
import Login from "./routes/Login";
import VerifyEmail from "./routes/VerifyEmail";
import ForgotPassword from "./routes/ForgotPassword";
import Landing from "./routes/Landing";
import Dashboard from "./routes/Dashboard";
import Projects from "./routes/Projects";
import ProjectDetail from "./routes/ProjectDetail";
import Tickets from "./routes/Tickets";
import Sprints from "./routes/Sprints";
import Tasks from "./routes/Tasks";
import Docker from "./routes/Docker";
import Postgres from "./routes/Postgres";
import Mail from "./routes/Mail";
import Calendar from "./routes/Calendar";
import Notifications from "./routes/Notifications";
import Automation from "./routes/Automation";
import TimeTracking from "./routes/TimeTracking";
import Docs from "./routes/Docs";
import Settings from "./routes/Settings";
import type { JSX } from "react";

function Guard({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-load">Loading ORBIT…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AgentProvider>
          <ZohoProvider>
          <TimezoneProvider>
          <BreakProvider>
          <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/verify" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route element={<Guard><Layout /></Guard>}>
              <Route path="/app" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/tickets" element={<Tickets />} />
              <Route path="/sprints" element={<Sprints />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/docker" element={<Docker />} />
              <Route path="/postgres" element={<Postgres />} />
              <Route path="/mail" element={<Mail />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/automation" element={<Automation />} />
              <Route path="/time" element={<TimeTracking />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </BrowserRouter>
          </BreakProvider>
          </TimezoneProvider>
          </ZohoProvider>
        </AgentProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
