# Ingestion cohort → agent mapping

Canonical labels (Ingestion `FILE_KINDS` / `INGESTION_DATASETS`):

| Ingestion id | Label | Session path key | Processed artifact |
|---|---|---|---|
| `dev_data` | Existing Train Data | `dev_data_path` | `processed_dev_path` |
| `new_data` | New Train Data | `new_data_path` | `processed_new_path` |
| `hold_data` | Existing Test Data | `hold_data_path` | `processed_hold_path` |
| `new_data_oos` | New Test Data | `new_data_oos_path` | `processed_oos_path` |

Recalibration-only artifacts (not ingestion uploads):

| Artifact | Session key | Use |
|---|---|---|
| Combined train (dev + new) | `processed_recal_train_path` | Evaluation train cohort metrics |
| Recalibrated scores on New Test | `oot_scores_path` (`recal_oos` kind) | Evaluation recalibrated OOS scores |

## Agent usage

| Agent | Cohorts used |
|---|---|
| Data processing | All four uploads → matching processed paths |
| Diagnostics — data drift | Existing Train vs **New Test** |
| Diagnostics — concept drift | Existing Train vs **New Test** |
| Diagnostics — performance | **Existing Test** vs **New Test** |
| Recalibration — training | Existing Train + **New Train** (append) |
| Recalibration — HP validation | **Existing Test** (hold) |
| Recalibration — score step | **New Test** → `oot_scores_path` |
| Evaluation — champion baseline | **Existing Test** |
| Evaluation — champion + recalibrated | **New Test** |

**New Train Data** is only for recalibration training append. **New Test Data** is used for drift comparison, performance comparison, recalibration scoring, and evaluation.
