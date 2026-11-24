import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

import { AuthProvider, captureReferral, useAuth } from "./hooks/useAuth";
import { SoundProvider } from "./hooks/useSound";
import { GameProvider } from "./hooks/useGame";
import { wagmiConfig } from "./lib/web3";
import { DEMO } from "./lib/supabase";
import { Reptile } from "./components/Reptile";

import Chapters from "./pages/Chapters";
import Lab from "./pages/Lab";
import Den from "./pages/Den";
import Callback from "./pages/Callback";
import Rush from "./pages/Rush";

import "./styles/app.css";

function RequireAuth({ children }: { children: ReactNode }) {
  const { signedIn, loading } = useAuth();
  if (loading) {
    return (
      <div className="paper-page">
        <div className="paper-bg" aria-hidden="true" />
        <div className="callback"><Reptile level={1} size={150} className="bob" /></div>
      </div>
    );
  }
  if (!signedIn) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const queryClient = new QueryClient();

export default function App() {
  useEffect(() => captureReferral(), []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({ accentColor: "#3fbf6f", accentColorForeground: "#08140c", borderRadius: "medium" })}
          modalSize="compact"
        >
          <SoundProvider>
            <AuthProvider>
              <GameProvider>
                <BrowserRouter>
                  {DEMO && <div className="demo-flag">Demo mode · fake data</div>}
                  <Routes>
                    <Route path="/" element={<Chapters />} />
                    <Route path="/callback" element={<Callback />} />
                    <Route path="/den" element={<Den />} />
                    <Route path="/lab" element={<RequireAuth><Lab /></RequireAuth>} />
                    <Route path="/rush" element={<Rush />} />
                    <Route path="/rush/:code" element={<Rush />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </BrowserRouter>
              </GameProvider>
            </AuthProvider>
          </SoundProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
