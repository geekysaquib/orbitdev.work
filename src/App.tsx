import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/Toast";
import { Layout } from "./components/Layout";
import Login from "./routes/Login";
import Dashboard from "./routes/Dashboard";
import Projects from "./routes/Projects";
import ProjectDetail from "./routes/ProjectDetail";
import Tickets from "./routes/Tickets";
import Tasks from "./routes/Tasks";
import Calendar from "./routes/Calendar";
import Notifications from "./routes/Notifications";
import Automation from "./routes/Automation";
import TimeTracking from "./routes/TimeTracking";
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
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Guard><Layout /></Guard>}>
              <Route index element={<Dashboard />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/:id" element={<ProjectDetail />} />
              <Route path="tickets" element={<Tickets />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="automation" element={<Automation />} />
              <Route path="time" element={<TimeTracking />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
