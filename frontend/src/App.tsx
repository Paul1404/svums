import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import ApplicationForm from "./pages/ApplicationForm";
import Success from "./pages/Success";
import UploadPage from "./pages/Upload";
import StatusPage from "./pages/StatusPage";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminApplicationDetail from "./pages/AdminApplicationDetail";
import AdminSettings from "./pages/AdminSettings";
import AdminCancellation from "./pages/AdminCancellation";
import AdminEmailLog from "./pages/AdminEmailLog";
import AdminDocuments from "./pages/AdminDocuments";
import { AdminProvider, useAdmin } from "./context/AdminContext";
import { ClubConfigProvider } from "./context/ClubConfigContext";
import { capturePageView } from "./lib/analytics";

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
      </Routes>
    </AdminProvider>
  );
}

function RouteAnalytics() {
  const location = useLocation();

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const state = (location.state ?? {}) as { signedOnline?: boolean } | null;
    let routeName: string | null = null;
    let appArea: "public" | "admin" | null = null;

    if (location.pathname === "/") {
      routeName = "application_form";
      appArea = "public";
    } else if (location.pathname === "/erfolg") {
      routeName = "success";
      appArea = "public";
    } else if (location.pathname.startsWith("/upload/")) {
      routeName = "upload";
      appArea = "public";
    } else if (location.pathname === "/status") {
      routeName = "status";
      appArea = "public";
    } else if (location.pathname === "/admin/login") {
      routeName = "admin_login";
      appArea = "admin";
    } else if (location.pathname === "/admin") {
      routeName = "admin_dashboard";
      appArea = "admin";
    } else if (location.pathname.startsWith("/admin/applications/")) {
      routeName = "admin_application_detail";
      appArea = "admin";
    } else if (location.pathname === "/admin/settings") {
      routeName = "admin_settings";
      appArea = "admin";
    } else if (location.pathname === "/admin/cancellation") {
      routeName = "admin_cancellation";
      appArea = "admin";
    } else if (location.pathname === "/admin/email-log") {
      routeName = "admin_email_log";
      appArea = "admin";
    } else if (location.pathname === "/admin/documents") {
      routeName = "admin_documents";
      appArea = "admin";
    }

    if (!routeName || !appArea) return;

    capturePageView(routeName, {
      app_area: appArea,
      has_query_nr: location.pathname === "/status" ? params.has("nr") : undefined,
      signed_online: location.pathname === "/erfolg" ? Boolean(state?.signedOnline) : undefined,
    });
  }, [location.pathname, location.search, location.state]);

  return null;
}

export default function App() {
  return (
    <ClubConfigProvider>
      <BrowserRouter>
        <RouteAnalytics />
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/" element={<ApplicationForm />} />
          <Route path="/erfolg" element={<Success />} />
          <Route path="/upload/:token" element={<UploadPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/admin/*" element={<AdminRoutes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ClubConfigProvider>
  );
}
