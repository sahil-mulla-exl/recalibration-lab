import { useState, useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionContext, usePersistedState, clearAllSessionState } from "@/contexts/session";
import { initSession } from "@/services/api";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { motion } from "framer-motion";
import {
  Check,
  Menu,
  LayoutList,
  Upload,
  SlidersHorizontal,
  BarChart2,
  Zap,
  GitCompare,
  Download,
  Sun,
  Moon,
  ChevronUp,
} from "lucide-react";

import ModelInventory from "@/pages/ModelInventory";
import Ingestion from "@/pages/Ingestion";
import DataProcessing from "@/pages/DataProcessing";
import Diagnostics from "@/pages/Diagnostics";
import RecalibrationProgress from "@/pages/RecalibrationProgress";
import Evaluation from "@/pages/Evaluation";
import ExportPage from "@/pages/Export";
import NotFound from "@/pages/not-found";
import { WorkflowCockpit } from "@/components/WorkflowCockpit";

const queryClient = new QueryClient();

const ACTIVITIES = [
  { path: "/", label: "Inventory", icon: LayoutList },
  { path: "/ingestion", label: "Ingestion", icon: Upload },
  { path: "/post-ingestion", label: "Data Processing", icon: SlidersHorizontal },
  { path: "/diagnostics", label: "Diagnostics", icon: BarChart2 },
  { path: "/recalibration", label: "Recalibration", icon: Zap },
  { path: "/evaluation", label: "Evaluation", icon: GitCompare },
  { path: "/export", label: "Export", icon: Download },
];

function Shell({
  children,
  step,
}: {
  children: React.ReactNode;
  step: number;
}) {
  const { theme, toggleTheme } = useTheme();
  const [loc, navigate] = useLocation();
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const normalizePath = (path: string) => {
    const withoutQuery = path.split("?")[0].split("#")[0];
    if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
      return withoutQuery.slice(0, -1);
    }
    return withoutQuery;
  };
  const normalizedLoc = normalizePath(loc);
  const currentStep = ACTIVITIES.findIndex((s) => {
    const stepPath = normalizePath(s.path);
    return normalizedLoc === stepPath || normalizedLoc.startsWith(`${stepPath}/`);
  });
  const activeStep = currentStep >= 0 ? currentStep : step;
  const maxStep = Math.max(step, activeStep);

  useEffect(() => {
    const node = mainScrollRef.current;
    if (!node) return;
    const onScroll = () => setShowScrollTop(node.scrollTop > 220);
    onScroll();
    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, [loc]);

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-gray-950 transition-colors duration-300">
      <header className="fixed top-0 left-0 right-0 z-[60] bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg border-b border-gray-200/20 dark:border-gray-700/30 shadow-sm transition-colors duration-300">
        <div className="flex items-center justify-between px-4 h-16">
          <div className="flex items-center space-x-4">
            <Menu className="h-5 w-5 text-gray-400 dark:text-gray-500" />
            <div className="flex items-center">
              <div>
                <h1 className="text-lg font-bold leading-tight" style={{ color: "#FB4E0B" }}>
                  EXLdecision.ai
                </h1>
                <p className="text-[10px] font-medium leading-tight tracking-wide text-[#005071] dark:text-slate-200">
                  Recalibration Lab
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <Sun className="h-5 w-5 text-yellow-400" />
              ) : (
                <Moon className="h-5 w-5 text-gray-600" />
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="fixed top-16 left-0 right-0 z-[55] border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div className="max-w-[1500px] mx-auto px-4 pt-3 pb-4">
          <div className="relative">
            <div className="absolute left-4 right-4 top-4 h-[3px] bg-gray-200 dark:bg-gray-700 rounded-full" />
            <div className="relative flex items-start justify-between gap-1">
              {ACTIVITIES.map((item, index) => {
                const Icon = item.icon;
                const completed = index <= maxStep && index !== activeStep && item.path !== null;
                const active = index === activeStep;
                const reachable = item.path !== null && index <= maxStep;
                return (
                  <button
                    key={item.label}
                    type="button"
                    disabled={!reachable}
                    onClick={() => {
                      if (item.path && reachable) navigate(item.path);
                    }}
                    className={`min-w-0 flex-1 flex flex-col items-center gap-2 ${reachable ? "cursor-pointer" : "cursor-default"}`}
                    title={item.label}
                  >
                    <div
                      className={`h-8 w-8 rounded-full border-2 flex items-center justify-center transition-colors ${
                        completed
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : active
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                      }`}
                    >
                      {completed ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </div>
                    <span
                      className={`text-[11px] leading-tight text-center font-medium px-1 ${
                        active
                          ? "text-blue-700 dark:text-blue-300"
                          : completed
                          ? "text-gray-800 dark:text-gray-100"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <main
        ref={mainScrollRef}
        className="workflow-scroll flex-1 overflow-y-auto overflow-x-hidden h-screen pt-[9.5rem] pb-6 px-4 lg:px-6"
      >
        <motion.div
          key={loc}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="max-w-7xl mx-auto"
        >
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm px-4 md:px-6 lg:px-8 py-6 md:py-7">
            {children}
          </div>
          <footer className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-3 text-[11px] text-gray-500 dark:text-gray-400">
            EXLdecision.ai - Recalibration Lab
          </footer>
        </motion.div>
      </main>

      {showScrollTop && (
        <button
          type="button"
          onClick={() => mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-5 right-5 z-[70] h-9 w-9 rounded-full border border-gray-300 dark:border-gray-600 bg-white/95 dark:bg-gray-900/95 text-gray-600 dark:text-gray-300 shadow-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Scroll to top"
          aria-label="Scroll to top"
        >
          <ChevronUp className="h-4 w-4 mx-auto" />
        </button>
      )}
    </div>
  );
}

function LegacyComparisonRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/evaluation");
  }, [navigate]);
  return null;
}

function AppInner() {
  const [loc, navigate] = useLocation();
  const [sessionId, setSessionId] = usePersistedState<string | null>("rcl:sessionId", null);
  const [step, setStep] = usePersistedState<number>("rcl:step", 0);
  const [selectedModel, setSelectedModel] = usePersistedState<Record<string, string> | null>("rcl:selectedModel", null);
  const [driftResult, setDriftResult] = usePersistedState<Record<string, unknown> | null>("rcl:driftResult", null);
  const [evaluationResult, setEvaluationResult] = usePersistedState<Record<string, unknown> | null>("rcl:evaluationResult", null);

  // Migrate persisted state from legacy Comparison agent key.
  useEffect(() => {
    if (evaluationResult) return;
    try {
      const legacy = localStorage.getItem("rcl:comparisonResult");
      if (legacy) {
        setEvaluationResult(JSON.parse(legacy) as Record<string, unknown>);
        localStorage.removeItem("rcl:comparisonResult");
      }
    } catch {
      /* ignore */
    }
  }, [evaluationResult, setEvaluationResult]);
  const [recalibrationResult, setRecalibrationResult] = usePersistedState<Record<string, unknown> | null>("rcl:recalibrationResult", null);
  const [filesLoaded, setFilesLoaded] = usePersistedState<boolean>("rcl:filesLoaded", false);

  // Initial session setup + stale-session recovery.
  // If localStorage has a session ID, verify it still exists on the backend.
  // If the backend has been restarted, all derived state is invalid — wipe
  // everything and reload to a clean state.
  useEffect(() => {
    if (!sessionId) {
      initSession().then((d) => setSessionId(d.session_id)).catch(console.error);
      return;
    }
    fetch(`/api/session/${sessionId}`)
      .then((res) => {
        if (res.status === 404) {
          clearAllSessionState();
          window.location.href = import.meta.env.BASE_URL || "/";
        }
      })
      .catch(() => {
        // Network error during validation — keep stored session and retry later
      });
  }, [sessionId, setSessionId]);

  // Guard: if a user navigates directly to a workflow page without a selected
  // model (e.g. fresh tab with a deep-linked URL), bounce them to the inventory.
  // We wait until sessionId is known so the redirect doesn't fire on first paint.
  useEffect(() => {
    if (sessionId && !selectedModel && loc !== "/") {
      setStep(0);
      navigate("/");
    }
  }, [sessionId, selectedModel, loc, navigate, setStep]);

  return (
    <SessionContext.Provider
      value={{
        sessionId,
        setSessionId,
        step,
        setStep,
        selectedModel,
        setSelectedModel,
        driftResult,
        setDriftResult,
        evaluationResult,
        setEvaluationResult,
        recalibrationResult,
        setRecalibrationResult,
        filesLoaded,
        setFilesLoaded,
      }}
    >
      <Shell step={step}>
        <WorkflowCockpit sessionId={sessionId} />
        <Switch>
          <Route path="/" component={ModelInventory} />
          <Route path="/ingestion" component={Ingestion} />
          <Route path="/post-ingestion" component={DataProcessing} />
          <Route path="/diagnostics" component={Diagnostics} />
          <Route path="/recalibration" component={RecalibrationProgress} />
          <Route path="/evaluation" component={Evaluation} />
          <Route path="/comparison" component={LegacyComparisonRedirect} />
          <Route path="/export" component={ExportPage} />
          <Route component={NotFound} />
        </Switch>
      </Shell>
    </SessionContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AppInner />
          </WouterRouter>
        </ThemeProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
