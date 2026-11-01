import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { browserStore } from "./storage";
import { applyTheme, readStoredTheme } from "./theme";
import "./styles.css";

// Apply the remembered theme before the first paint, so someone who chose the
// light theme does not get a dark flash on every load.
applyTheme(readStoredTheme(browserStore()));

const container = document.getElementById("root");
if (container === null) throw new Error("#root missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
