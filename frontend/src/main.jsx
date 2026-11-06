import { Buffer } from "buffer";
// @near-js libraries expect Node's Buffer in the browser
globalThis.Buffer = globalThis.Buffer || Buffer;

import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
