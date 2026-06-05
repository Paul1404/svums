import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import ApplicationForm from "./pages/ApplicationForm";
import Success from "./pages/Success";
import UploadPage from "./pages/Upload";
import PaperFormUpload from "./pages/PaperFormUpload";
import StatusPage from "./pages/StatusPage";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminApplicationDetail from "./pages/AdminApplicationDetail";
import AdminSettings from "./pages/AdminSettings";
import AdminClubSettings from "./pages/AdminClubSettings";
import AdminCancellation from "./pages/AdminCancellation";
import AdminEmailLog from "./pages/AdminEmailLog";
import AdminDocuments from "./pages/AdminDocuments";
import AdminLegacyApplication from "./pages/AdminLegacyApplication";
import AdminImportedMembers from "./pages/AdminImportedMembers";
import { AdminProvider, useAdmin } from "./context/AdminContext";
import { ClubConfigProvider } from "./context/ClubConfigContext";
import { ThemeProvider } from "./context/ThemeContext";
import ThemeToggle from "./components/ThemeToggle";
import CommandPalette from "./components/CommandPalette";

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAdmin();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-svu-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoutes() {
  return (
    <AdminProvider>
      <CommandPalette />
      <Routes>
        <Route path="login" element={<AdminLogin />} />
        <Route
          path=""
          element={
            <AdminRoute>
              <AdminDashboard />
            </AdminRoute>
          }
        />
        <Route
          path="applications/:id"
          element={
            <AdminRoute>
              <AdminApplicationDetail />
            </AdminRoute>
          }
        />
        <Route
          path="settings"
          element={
            <AdminRoute>
              <AdminSettings />
            </AdminRoute>
          }
        />
        <Route
          path="club-settings"
          element={
            <AdminRoute>
              <AdminClubSettings />
            </AdminRoute>
          }
        />
        <Route
          path="cancellation"
          element={
            <AdminRoute>
              <AdminCancellation />
            </AdminRoute>
          }
        />
        <Route
          path="email-log"
          element={
            <AdminRoute>
              <AdminEmailLog />
            </AdminRoute>
          }
        />
        <Route
          path="documents"
          element={
            <AdminRoute>
              <AdminDocuments />
            </AdminRoute>
          }
        />
        <Route
          path="legacy-application"
          element={
            <AdminRoute>
              <AdminLegacyApplication />
            </AdminRoute>
          }
        />
        <Route
          path="imported"
          element={
            <AdminRoute>
              <AdminImportedMembers />
            </AdminRoute>
          }
        />
      </Routes>
    </AdminProvider>
  );
}

function FloatingThemeToggle() {
  const location = useLocation();
  // Admin pages (except login) have their own dense header and the command
  // palette (⌘K) covers theme switching, so the floating pill would only
  // collide with header buttons and drawer close icons.
  const isAdminWithHeader =
    location.pathname.startsWith("/admin") && location.pathname !== "/admin/login";
  if (isAdminWithHeader) return null;
  return <ThemeToggle floating />;
}

export default function App() {
  return (
    <ThemeProvider>
      <ClubConfigProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors theme="system" />
          <FloatingThemeToggle />
          <Routes>
            <Route path="/" element={<ApplicationForm />} />
            <Route path="/erfolg" element={<Success />} />
            <Route path="/upload/:token" element={<UploadPage />} />
            <Route path="/papierformular" element={<PaperFormUpload />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/admin/*" element={<AdminRoutes />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ClubConfigProvider>
    </ThemeProvider>
  );
}
