import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "./ui/Card";
import Button from "./ui/Button";
import { logout } from "../api/client";

export default function AppHeader() {
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const onLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      console.error(e);
      setIsLoggingOut(false);
    }
  };

  return (
    <Card
      title="Chart Extraction"
      description="Загрузка изображения и запуск обработки"
      right={
        <Button
          variant="secondary"
          onClick={onLogout}
          loading={isLoggingOut}
          disabled={isLoggingOut}
          type="button"
        >
          Выйти
        </Button>
      }
      className="mb-6"
    />
  );
}

