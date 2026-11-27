import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// One canonical address: www.reptilio.fun → reptilio.fun. Sign-in keeps a
// one-time secret per address, so starting on www and finishing without it
// would fail.
if (window.location.hostname.startsWith("www.")) {
  window.location.replace(
    `${window.location.protocol}//${window.location.hostname.slice(4)}${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
