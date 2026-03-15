import React from "react";
import ReactDOM from "react-dom/client";
import "./global.css";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import { initDefaultAdmin } from "./utils/auth";   // 👈 THÊM DÒNG NÀY

initDefaultAdmin();  // 👈 THÊM DÒNG NÀY (rất quan trọng)

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
