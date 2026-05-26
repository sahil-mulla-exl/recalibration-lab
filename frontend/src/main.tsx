import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

try {
  const storedTheme = localStorage.getItem("midas-theme") ?? localStorage.getItem("rcl:theme");
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true;
  const isDark = storedTheme ? storedTheme === "dark" : prefersDark;
  document.documentElement.classList.toggle("dark", isDark);
} catch {
  document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(<App />);
