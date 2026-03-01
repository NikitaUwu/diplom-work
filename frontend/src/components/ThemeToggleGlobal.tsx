import { useEffect, useState } from "react";
import Button from "./ui/Button";
import { toggleTheme, getInitialTheme, applyTheme, type Theme } from "../theme";

export default function ThemeToggleGlobal() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  useEffect(() => {
    const t = getInitialTheme();
    applyTheme(t);
    setTheme(t);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[1000]">
      <Button
        variant="secondary"
        type="button"
        onClick={() => setTheme(toggleTheme())}
      >
        {theme === "dark" ? "Светлая" : "Тёмная"}
      </Button>
    </div>
  );
}