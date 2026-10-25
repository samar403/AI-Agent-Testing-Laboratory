import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import "./styles.css";
import { Layout } from "./components/Layout.tsx";
import { ToastProvider } from "./lib.tsx";
import { Landing } from "./pages/Landing.tsx";
import { Overview } from "./pages/Overview.tsx";
import { AgentDetail, Agents } from "./pages/Agents.tsx";
import { SuiteEditor, Suites } from "./pages/Suites.tsx";
import { NewExperiment } from "./pages/NewExperiment.tsx";
import { RunDetail, Runs } from "./pages/Runs.tsx";
import { TrialDetail } from "./pages/TrialDetail.tsx";
import { Compare } from "./pages/Compare.tsx";
import { Billing } from "./pages/Billing.tsx";
import { Settings } from "./pages/Settings.tsx";
import { Docs } from "./pages/Docs.tsx";

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  {
    element: <Layout />,
    children: [
      { path: "/lab", element: <Overview /> },
      { path: "/lab/agents", element: <Agents /> },
      { path: "/lab/agents/:id", element: <AgentDetail /> },
      { path: "/lab/suites", element: <Suites /> },
      { path: "/lab/suites/new", element: <SuiteEditor /> },
      { path: "/lab/suites/:id", element: <SuiteEditor /> },
      { path: "/lab/experiments/new", element: <NewExperiment /> },
      { path: "/lab/runs", element: <Runs /> },
      { path: "/lab/runs/:id", element: <RunDetail /> },
      { path: "/lab/runs/:id/trials/:trialId", element: <TrialDetail /> },
      { path: "/lab/compare", element: <Compare /> },
      { path: "/lab/billing", element: <Billing /> },
      { path: "/lab/settings", element: <Settings /> },
      { path: "/docs", element: <Docs /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);
