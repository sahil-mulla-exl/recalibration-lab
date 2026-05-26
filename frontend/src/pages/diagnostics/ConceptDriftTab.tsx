import { useMemo, useState } from "react";

import { CONCEPT_SUBTABS } from "@/config/diagnostics";

import { ChartCard } from "@/components/diagnostics/ChartCard";

import { IvStrengthChart } from "@/components/diagnostics/IvStrengthChart";

import { MonotonicityChart } from "@/components/diagnostics/MonotonicityChart";

import { driftBaselineLabel, driftCompareSubtitle, INGESTION_DATASETS } from "@/config/datasets";
import { SubTabBar } from "@/components/diagnostics/SubTabBar";

import { useSession } from "@/contexts/session";

import { downloadDiagnosticsReportFile } from "@/services/api";

import { UnivariateAucChart } from "@/components/diagnostics/UnivariateAucChart";



type ConceptDriftTabProps = {

  report: Record<string, unknown>;

};



export function ConceptDriftTab({ report }: ConceptDriftTabProps) {

  const { sessionId } = useSession();

  const [subtab, setSubtab] = useState<string>("iv");

  const [downloadBusy, setDownloadBusy] = useState(false);

  const [ivSort, setIvSort] = useState<"rank" | "delta">("delta");

  const [ivTop, setIvTop] = useState<number>(15);

  const [aucSort, setAucSort] = useState<"rank" | "delta">("delta");

  const [aucTop, setAucTop] = useState<number>(15);

  const [monoFeature, setMonoFeature] = useState<string>("");

  const concept = (report.concept_drift ?? {}) as Record<string, any>;

  const iv = (concept.iv ?? {}) as Record<string, { iv_train?: number; iv_new?: number; delta?: number; rating?: string }>;

  const uniAuc = (concept.univariate_auc ?? {}) as Record<string, { train_auc?: number; new_auc?: number }>;

  const bivariate = (concept.bivariate_monotonicity ?? {}) as Record<

    string,

    {

      bin_labels?: string[];

      train_rate?: number[];

      new_rate?: number[];

      train_population_pct?: number[];

      new_population_pct?: number[];

      mono_train?: boolean;

      mono_new?: boolean;

    }

  >;



  const selectedFeature = monoFeature || Object.keys(bivariate)[0] || "";

  const ivRows = useMemo(() => {

    const rows = Object.entries(iv).map(([feature, vals]) => ({

      feature,

      ivTrain: Number(vals.iv_train ?? 0),

      ivNew: Number(vals.iv_new ?? 0),

      delta: Number(vals.delta ?? 0),

      rating: String(vals.rating ?? "stable"),

    }));

    rows.sort((a, b) => (ivSort === "rank" ? b.ivTrain - a.ivTrain : a.delta - b.delta));

    return rows.slice(0, ivTop === 9999 ? rows.length : ivTop);

  }, [iv, ivSort, ivTop]);

  const aucRows = useMemo(() => {

    const rows = Object.entries(uniAuc).map(([feature, vals]) => {

      const trainAuc = Number(vals.train_auc ?? 0);

      const newAuc = Number(vals.new_auc ?? 0);

      return { feature, trainAuc, newAuc, delta: newAuc - trainAuc };

    });

    rows.sort((a, b) => (aucSort === "rank" ? b.trainAuc - a.trainAuc : a.delta - b.delta));

    return rows.slice(0, aucTop === 9999 ? rows.length : aucTop);

  }, [uniAuc, aucSort, aucTop]);

  const bivariateData = useMemo(() => {

    if (!selectedFeature) return [];

    const row = bivariate[selectedFeature] ?? {};

    const labels = row.bin_labels ?? [];

    const train = row.train_rate ?? [];

    const current = row.new_rate ?? [];

    const trainPop = row.train_population_pct ?? [];

    const newPop = row.new_population_pct ?? [];

    return labels.map((x, idx) => ({

      x,

      train: Number(train[idx] ?? 0),

      new: Number(current[idx] ?? 0),

      trainPop: Number(trainPop[idx] ?? 0),

      newPop: Number(newPop[idx] ?? 0),

    }));

  }, [bivariate, selectedFeature]);



  const bivariateRow = bivariate[selectedFeature] ?? {};

  const bivariateConclusion =

    bivariateRow.mono_new === false

      ? "Monotonicity broken on new data"

      : bivariateRow.mono_train === false

        ? `Monotonicity broken on ${driftBaselineLabel().toLowerCase()}`

        : "Bivariate pattern preserved";



  return (

    <div className="space-y-4">

      <div className="flex items-center justify-between gap-2">

        <SubTabBar value={subtab} onValueChange={setSubtab} items={CONCEPT_SUBTABS} />

        <button

          type="button"

          className="h-8 rounded border px-3 text-xs bg-white dark:bg-slate-900 disabled:opacity-60"

          disabled={!sessionId || downloadBusy}

          onClick={async () => {

            if (!sessionId) return;

            try {

              setDownloadBusy(true);

              await downloadDiagnosticsReportFile(sessionId, "concept", report);

            } finally {

              setDownloadBusy(false);

            }

          }}

        >

          {downloadBusy ? "Downloading..." : "Download report"}

        </button>

      </div>



      {subtab === "iv" && (

        <div className="space-y-4">

          <ChartCard

            title="Information Value (IV)"

            subtitle={`Model features from .pkl — ${driftCompareSubtitle()} IV`}

            actions={(

              <div className="flex items-center gap-2 text-xs">

                <span className="text-muted-foreground">Sort</span>

                <select className="h-8 rounded border px-2 bg-background" value={ivSort} onChange={(e) => setIvSort(e.target.value as "rank" | "delta")}>

                  <option value="rank">IV rank ({driftBaselineLabel()})</option>

                  <option value="delta">IV delta (worst first)</option>

                </select>

                <span className="text-muted-foreground">Top</span>

                <select className="h-8 rounded border px-2 bg-background" value={String(ivTop)} onChange={(e) => setIvTop(Number(e.target.value))}>

                  <option value="5">5</option>

                  <option value="10">10</option>

                  <option value="15">15</option>

                  <option value="9999">All</option>

                </select>

              </div>

            )}

          >

            <IvStrengthChart rows={ivRows} />

          </ChartCard>

          <ChartCard

            title="Univariate AUC"

            subtitle="Model features from .pkl — single-feature AUC stability"

            actions={(

              <div className="flex items-center gap-2 text-xs">

                <span className="text-muted-foreground">Sort</span>

                <select className="h-8 rounded border px-2 bg-background" value={aucSort} onChange={(e) => setAucSort(e.target.value as "rank" | "delta")}>

                  <option value="rank">AUC rank ({driftBaselineLabel()})</option>

                  <option value="delta">AUC decline (worst first)</option>

                </select>

                <span className="text-muted-foreground">Top</span>

                <select className="h-8 rounded border px-2 bg-background" value={String(aucTop)} onChange={(e) => setAucTop(Number(e.target.value))}>

                  <option value="10">10</option>

                  <option value="15">15</option>

                  <option value="9999">All</option>

                </select>

              </div>

            )}

          >

            <UnivariateAucChart rows={aucRows} />

          </ChartCard>

        </div>

      )}



      {subtab === "monotonicity" && (

        <ChartCard
          title="Bivariate relationship"
          subtitle={
            selectedFeature
              ? `Population % vs event rate · ${selectedFeature}`
              : "No feature data"
          }
          conclusion={bivariateConclusion}

          actions={(

            <select

              className="h-8 rounded border px-2 bg-background"

              value={selectedFeature}

              onChange={(e) => setMonoFeature(e.target.value)}

            >

              {Object.keys(bivariate).map((feature) => (

                <option key={feature} value={feature}>

                  {feature}

                </option>

              ))}

            </select>

          )}

        >

          <MonotonicityChart
            data={bivariateData}
            monoTrain={bivariateRow.mono_train}
            monoNew={bivariateRow.mono_new}
          />

        </ChartCard>

      )}

    </div>

  );

}

