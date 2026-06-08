import { allIngestionDatasetLabels, INGESTION_DATASETS } from "@/config/datasets";

const DEV = INGESTION_DATASETS.dev_data.label;
const NEW = INGESTION_DATASETS.new_data.label;
const HOLD = INGESTION_DATASETS.hold_data.label;
const NEW_VAL = INGESTION_DATASETS.new_data_oos.label;
const ALL = allIngestionDatasetLabels();

const PHRASE_REPLACEMENTS: Array<[string, string]> = [
  ["Apply preprocessing to dev/new/hold/OOS data", `Apply preprocessing (${ALL})`],
  ["Apply feature engineering to dev/new/hold/OOS data", `Apply feature engineering (${ALL})`],
  ["Score dev data with model", `Score ${DEV} with model`],
  ["Score new data with model", `Score ${NEW} with model`],
  ["Score hold (OOT) data with model", `Score ${HOLD} with model`],
  ["Score new data OOS with model", `Score ${NEW_VAL} with model`],
  ["dev/new/hold/OOS", ALL],
  ["Dev/New/Hold/OOS", ALL],
  ["dev/new/hold", `${DEV}, ${NEW}, and ${HOLD}`],
  ["(dev/new/hold)", `(${DEV}, ${NEW}, and ${HOLD})`],
  ["new data OOS", NEW_VAL],
  ["New data OOS", NEW_VAL],
  ["Hold (OOT)", HOLD],
  ["hold (OOT)", HOLD],
  ["hold records", `${HOLD} records`],
  ["hold data", HOLD],
  ["Hold data", HOLD],
  ["hold=", `${HOLD}=`],
  ["hold:", `${HOLD}:`],
  ["no hold data", `no ${HOLD}`],
  ["OOS records", `${NEW_VAL} records`],
  ["OOS scored", `${NEW_VAL} scored`],
  ["OOS data", NEW_VAL],
  ["no OOS data", `no ${NEW_VAL}`],
  ["OOS", NEW_VAL],
  ["dev records", `${DEV} records`],
  ["dev data", DEV],
  ["Dev data", DEV],
  ["dev=", `${DEV}=`],
  ["new records", `${NEW} records`],
  ["new data", NEW],
  ["New data", NEW],
  ["new=", `${NEW}=`],
  ["old holdout", HOLD],
  ["new holdout", NEW_VAL],
  ["Old holdout", HOLD],
  ["New holdout", NEW_VAL],
  ["out-of-time holdout", NEW_VAL],
  ["holdouts", `${HOLD} and ${NEW_VAL}`],
  ["Processed hold", `Processed ${HOLD}`],
  ["Processed OOS", `Processed ${NEW_VAL}`],
  ["Processed dev", `Processed ${DEV}`],
  ["Processed new", `Processed ${NEW}`],
  ["Production", "Existing Model"],
  ["production", "existing model"],
  ["Holdout", "Test"],
  ["holdout", "test"],
  ["Development Data", DEV],
  ["New Data", NEW],
  ["Development Validation Sample", HOLD],
  ["New Validation Sample", NEW_VAL],
  ["Generating GenAI evaluation insights (when LLM is configured)…", "Generating AI evaluation insights…"],
  ["Generating GenAI insights (when LLM is configured)…", "Generating AI insights…"],
  ["GenAI evaluation insights skipped:", "AI evaluation insights skipped:"],
  ["GenAI insights skipped:", "AI insights skipped:"],
  ["LLM is not configured. Set LLM_USE_GATEWAY or LLM_CHAT_API_KEY in backend/.env", "AI is not configured. Re-run this agent after AI is configured in the backend."],
  ["empty LLM response", "empty AI response"],
  ["GenAI insights", "AI insights"],
  ["GenAI", "AI"],
  ["LLM", "AI"],
  ["Jaccard", "feature set overlap"],
  ["jaccard", "feature set overlap"],
];

/** Replace legacy dev/new/hold/OOS shorthand in agent logs and summaries. */
export function humanizeDatasetText(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [from, to] of PHRASE_REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}
