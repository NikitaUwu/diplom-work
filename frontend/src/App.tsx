import { Routes, Route, Navigate } from "react-router-dom";
import UploadPage from "./pages/UploadPage";
import ChartPage from "./pages/ChartPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<UploadPage />} />
      <Route path="/charts/:id" element={<ChartPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
