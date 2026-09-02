"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type AdminTheme = "dark" | "light";

const STORAGE_KEY = "citaya-admin-theme";

function getStoredTheme(): AdminTheme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

function applyTheme(theme: AdminTheme) {
  document.documentElement.dataset.citayaAdminTheme = theme;
}

function subscribe(callback: () => void) {
  const handleChange = () => {
    applyTheme(getStoredTheme());
    callback();
  };
  window.addEventListener("storage", handleChange);
  window.addEventListener("citaya-admin-theme-change", handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener("citaya-admin-theme-change", handleChange);
  };
}

function getServerTheme(): AdminTheme {
  return "dark";
}

export default function AdminThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getStoredTheme, getServerTheme);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new Event("citaya-admin-theme-change"));
  };

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className="admin-theme-toggle inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-sm font-black transition focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-transparent"
      title={isDark ? "Modo claro" : "Modo oscuro"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span>{isDark ? "Claro" : "Oscuro"}</span>
    </button>
  );
}
