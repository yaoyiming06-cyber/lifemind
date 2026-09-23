import React from "react";
import { createRoot } from "react-dom/client";
import "./app/globals.css";
import LifeMindApp from "./app/page";

const root = document.getElementById("root");

if (!root) {
  throw new Error("LifeMind root element was not found.");
}

createRoot(root).render(
  <React.StrictMode>
    <LifeMindApp />
  </React.StrictMode>,
);
