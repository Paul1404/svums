import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import { AdminProvider, useAdmin } from "./context/AdminContext";

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
      </Routes>
    </AdminProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
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
  );
}
