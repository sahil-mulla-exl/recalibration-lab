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
