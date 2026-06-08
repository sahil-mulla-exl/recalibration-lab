function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function downloadTextFile(content: string, filename: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Download a single-column feature list as CSV (header: feature). */
export function downloadFeatureListCsv(features: string[], filename: string) {
  const lines = ["feature", ...features.map(escapeCsvCell)];
  downloadTextFile(lines.join("\n"), filename, "text/csv;charset=utf-8");
}

/** Download selected features as .xlsx via backend export API. */
/** Download combined Existing Train + New Train recalibration dataset (CSV). Available after Data Processing. */
export async function downloadRecalibrationTrainingData(
  sessionId: string,
  filename = "recalibration_training_data.csv",
) {
  const res = await fetch(`/api/export/recalibration-training-data?session_id=${encodeURIComponent(sessionId)}&format=csv`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Recalibration dataset export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function downloadFeatureListXlsx(
  sessionId: string,
  features: string[],
  filename = "final_feature_list.xlsx",
) {
  const res = await fetch("/api/export/feature-list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, features }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Feature list export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
