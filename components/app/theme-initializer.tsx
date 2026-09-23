"use client";

import { useLayoutEffect } from "react";

const THEME_STORAGE_KEY = "trade-os-theme";
const THEME_CHANGE_EVENT = "trade-os-theme-change";

export function ThemeInitializer() {
  useLayoutEffect(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      const dark = savedTheme
        ? savedTheme === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;

      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    } catch {
      // Keep the server-rendered light theme if browser storage is unavailable.
    }
  }, []);

  return null;
}
