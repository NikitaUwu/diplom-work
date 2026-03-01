import { Routes, Route, Navigate } from "react-router-dom";
import UploadPage from "./pages/UploadPage";
import ChartPage from "./pages/ChartPage";
import ResultsPage from "./pages/ResultsPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import { RequireAuth, RedirectIfAuth } from "./routes";
import ThemeToggleGlobal from "./components/ThemeToggleGlobal";

export default function App() {
  return (
    <>
      <ThemeToggleGlobal />

      <Routes>
        <Route path="/" element={<RedirectIfAuth to="/upload" otherwise="/login" />} />

        <Route
          path="/login"
          element={
            <RedirectIfAuth to="/upload">
              <LoginPage />
            </RedirectIfAuth>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfAuth to="/upload">
              <RegisterPage />
            </RedirectIfAuth>
          }
        />

        <Route
          path="/upload"
          element={
            <RequireAuth>
              <UploadPage />
            </RequireAuth>
          }
        />
        <Route
          path="/results"
          element={
            <RequireAuth>
              <ResultsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/charts/:id"
          element={
            <RequireAuth>
              <ChartPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}