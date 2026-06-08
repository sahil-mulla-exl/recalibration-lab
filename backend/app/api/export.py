import os
import json
from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter, Body, Query
from fastapi.responses import FileResponse, Response
from backend.app.utils.session import get_session, session_dir, update_session
from backend.app.utils.export_scores import (
    build_score_comparison,
    ensure_predicted_proba,
    pick_reference_score_column,
    prepare_score_comparison_table,
    resolve_prediction_column,
    resolve_upload_reference_path,
)
from backend.app.utils.data_io import read_tabular_dataframe
from backend.app.utils.processed_paths import (
    ensure_recalibration_training_artifact,
    processed_csv_path,
    score_comparison_path,
)

router = APIRouter()

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")

_RECALIBRATION_DECISION_LABELS = {
    "no_action": "Do not recalibrate",
    "recal_simple": "Recalibrate — same hyperparameters",
    "recal_opt": "Recalibrate — with hyperparameter optimisation",
    "redevelop": "Model redevelopment",
    "model_redevelopment": "Model redevelopment",
}


def _recalibration_decision_label(session: dict) -> str:
    action = str(session.get("selected_recommended_action") or "").strip().lower()
    if not action:
        recal = session.get("recalibration_result") or {}
        action = str(recal.get("selected_action") or "").strip().lower()
    return _RECALIBRATION_DECISION_LABELS.get(action, action.replace("_", " ").title() if action else "—")


@router.get("/model")
async def export_model(session_id: str = Query(...)):
    session = get_session(session_id)
    if not session:
        return Response(content="Session not found", status_code=404)
    if (session.get("model_promotion_status") or "").lower() == "block":
        return Response(
            content="Model promotion blocked by policy guardrails. Resolve critical violations before export.",
            status_code=403,
        )
    model_path = session.get("new_model_path")
    if not model_path or not os.path.exists(model_path):
        # Fall back to original model
        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
        model_path = os.path.join(data_dir, "card_response_v2.3.pkl")
    if not os.path.exists(model_path):
        return Response(content="Model file not found", status_code=404)
    return FileResponse(
        model_path,
        media_type="application/octet-stream",
        filename="recalibrated_model.pkl",
    )


@router.get("/log")
async def export_log(session_id: str = Query(...)):
    session = get_session(session_id)
    if not session:
        return Response(content="Session not found", status_code=404)
    log_path = session.get("log_path")
    if log_path and os.path.exists(log_path):
        return FileResponse(log_path, media_type="application/json", filename="recalibration_log.json")

    # Build a log from available session data
    log = {
        "session_id": session_id,
        "model_id": session.get("model_id"),
        "reproducibility": session.get("reproducibility_result"),
        "drift": {k: v for k, v in (session.get("drift_result") or {}).items()
                  if k not in ("variable_distributions", "dev_lift_table", "new_lift_table", "calibration_dev", "calibration_new")},
        "recalibration": session.get("recalibration_result"),
        "evaluation": {k: v for k, v in (session.get("evaluation_result") or session.get("comparison_result") or {}).items()
                       if k not in ("migration_matrix", "migration_pct", "orig_roc", "new_roc", "orig_lift_table", "new_lift_table")},
    }
    return Response(
        content=json.dumps(log, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=recalibration_log.json"},
    )


@router.get("/report")
async def export_report(session_id: str = Query(...)):
    """Generate a PDF summary report using reportlab."""
    session = get_session(session_id)
    if not session:
        return Response(content="Session not found", status_code=404)

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        import io as _io

        buffer = _io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2*cm, bottomMargin=2*cm)
        styles = getSampleStyleSheet()
        story = []

        title_style = ParagraphStyle("Title", parent=styles["Title"], fontSize=18, spaceAfter=12)
        h2_style = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceAfter=6)
        normal_style = styles["Normal"]

        story.append(Paragraph("Recalibration Lab — Model Report", title_style))
        story.append(Paragraph(f"Session: {session_id[:16]}...", normal_style))
        story.append(Spacer(1, 0.5*cm))

        # Model info
        model_entry = session.get("model_entry") or {}
        story.append(Paragraph("Model Information", h2_style))
        model_data = [
            ["Field", "Value"],
            ["Model Name", model_entry.get("model_name", "—")],
            ["Model ID", model_entry.get("model_id", "—")],
            ["Class", model_entry.get("model_class", "—")],
            ["Use Case", model_entry.get("use_case", "—")],
        ]
        t = Table(model_data, colWidths=[5*cm, 10*cm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1A1F2E")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.5*cm))

        # Drift summary
        drift = session.get("drift_result") or {}
        if drift:
            story.append(Paragraph("Drift Diagnostics Summary", h2_style))
            drift_data = [
                ["Metric", "Value"],
                ["Overall PSI", str(drift.get("overall_psi", "—"))],
                ["Dev AUC", str(drift.get("orig_auc", "—"))],
                ["New AUC", str(drift.get("new_auc", "—"))],
                ["AUC Drop (pp)", str(drift.get("auc_drop_pp", "—"))],
                ["Max Calibration Error", f"{drift.get('max_calibration_dev_pct', 0):.1f}%"],
                ["Drift Verdict", _recalibration_decision_label(session)],
            ]
            t2 = Table(drift_data, colWidths=[7*cm, 8*cm])
            t2.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1A1F2E")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
            ]))
            story.append(t2)
            story.append(Spacer(1, 0.5*cm))
            story.append(Paragraph(f"Rationale: {drift.get('rationale', '')}", normal_style))
            story.append(Spacer(1, 0.5*cm))

        # Comparison summary
        comp = session.get("evaluation_result") or session.get("comparison_result") or {}
        if comp:
            story.append(Paragraph("Model Evaluation (OOT)", h2_style))
            comp_data = [
                ["Metric", "Original", "Recalibrated"],
                ["AUC", str(comp.get("orig_auc", "—")), str(comp.get("new_auc", "—"))],
                ["KS Stat", str(comp.get("orig_ks", "—")), str(comp.get("new_ks", "—"))],
                ["Gini", str(comp.get("orig_gini", "—")), str(comp.get("new_gini", "—"))],
                ["Calibration Error", f"{comp.get('orig_cal_error', 0):.1f}%", f"{comp.get('new_cal_error', 0):.1f}%"],
                ["Top-Decile Lift", str(comp.get("top_decile_lift_orig", "—")), str(comp.get("top_decile_lift_new", "—"))],
            ]
            t3 = Table(comp_data, colWidths=[6*cm, 4.5*cm, 4.5*cm])
            t3.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1A1F2E")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
            ]))
            story.append(t3)

        doc.build(story)
        pdf_bytes = buffer.getvalue()

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=recalibration_report.pdf"},
        )
    except Exception as e:
        return Response(content=f"PDF generation error: {e}", status_code=500)


def _resolve_processed_path(session: dict, dataset: str) -> str | None:
    if dataset == "dev":
        return session.get("processed_dev_path")
    if dataset == "new":
        return session.get("processed_new_path")
    if dataset == "oot":
        return session.get("processed_oos_path")
    if dataset == "recal_oos":
        return session.get("oot_scores_path")
    if dataset == "hold":
        return session.get("processed_hold_path")
    return None


@router.get("/processed-data")
async def export_processed_data(
    session_id: str = Query(...),
    dataset: str = Query("dev", pattern="^(dev|new|hold|oot|recal_oos)$"),
    format: str = Query("csv", pattern="^(csv|parquet)$"),
):
    """Export processed dataset with score and predicted_proba columns."""
    session = get_session(session_id)
    if not session:
        return Response(content="Session not found", status_code=404)

    csv_key = {
        "dev": "processed_dev_csv_path",
        "new": "processed_new_csv_path",
        "hold": "processed_hold_csv_path",
        "oot": "processed_oos_csv_path",
        "recal_oos": "oot_scores_csv_path",
    }.get(dataset)
    csv_on_disk = session.get(csv_key) if csv_key else None
    if format == "csv" and csv_on_disk and os.path.exists(csv_on_disk):
        return FileResponse(
            csv_on_disk,
            media_type="text/csv",
            filename=os.path.basename(csv_on_disk),
        )

    path = _resolve_processed_path(session, dataset)
    if not path or not os.path.exists(path):
        fallback_csv = processed_csv_path(session_id, dataset)  # type: ignore[arg-type]
        if format == "csv" and os.path.exists(fallback_csv):
            return FileResponse(
                fallback_csv,
                media_type="text/csv",
                filename=os.path.basename(fallback_csv),
            )
        return Response(content=f"Processed {dataset} data not found", status_code=404)

    df = pd.read_parquet(path) if path.endswith(".parquet") else read_tabular_dataframe(path)
    df = ensure_predicted_proba(df)

    ext = "csv" if format == "csv" else "parquet"
    out_path = processed_csv_path(session_id, dataset) if format == "csv" else path  # type: ignore[arg-type]
    if format == "csv":
        df.to_csv(out_path, index=False)
        media = "text/csv"
    else:
        media = "application/octet-stream"

    return FileResponse(
        out_path,
        media_type=media,
        filename=os.path.basename(out_path),
    )


@router.get("/score-comparison-data")
async def score_comparison_data(
    session_id: str = Query(...),
    dataset: str = Query("dev", pattern="^(dev|new)$"),
    limit: int = Query(200, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    """Return paginated rows from the session score comparison CSV plus summary stats."""
    session = get_session(session_id)
    if not session:
        return {"error": "Session not found"}

    repro = session.get("reproducibility_result") or {}
    path = (
        session.get(f"score_comparison_{dataset}_path")
        or repro.get("score_comparison_path")
        or score_comparison_path(session_id, dataset)
    )
    if not path or not os.path.exists(path):
        return {
            "error": "Score comparison file not found",
            "path": path,
            "summary": repro.get("score_comparison_summary") or session.get(f"score_comparison_{dataset}_summary"),
        }

    df = prepare_score_comparison_table(pd.read_csv(path))
    total_rows = int(len(df))
    slice_df = df.iloc[offset : offset + limit]
    columns = [str(c) for c in slice_df.columns.tolist()]
    rows = json.loads(slice_df.to_json(orient="records", date_format="iso"))

    summary = (
        repro.get("score_comparison_summary")
        or session.get(f"score_comparison_{dataset}_summary")
        or {}
    )

    return {
        "path": path,
        "filename": os.path.basename(path),
        "columns": columns,
        "rows": rows,
        "total_rows": total_rows,
        "offset": offset,
        "limit": limit,
        "summary": summary,
    }


@router.get("/score-comparison")
async def export_score_comparison(
    session_id: str = Query(...),
    dataset: str = Query("dev", pattern="^(dev|new)$"),
    reference_path: str | None = Query(default=None),
    file_format: str = Query("csv", alias="format", pattern="^(csv|xlsx)$"),
):
    """
    Export merged comparison: platform score vs prediction column selected at ingestion.
    """
    session = get_session(session_id)
    if not session:
        return Response(content="Session not found", status_code=404)

    prediction_col = resolve_prediction_column(session)
    if not prediction_col:
        return Response(
            content="Prediction column not configured; select it on the Ingestion page.",
            status_code=400,
        )

    platform_path = _resolve_processed_path(session, dataset)
    if not platform_path or not os.path.exists(platform_path):
        return Response(content=f"Processed {dataset} data not found", status_code=404)

    ref_path = reference_path or resolve_upload_reference_path(session, dataset)
    if not ref_path or not os.path.exists(ref_path):
        return Response(
            content=f"Uploaded {dataset} data not found for score comparison",
            status_code=404,
        )
    ref_df = read_tabular_dataframe(ref_path)
    if not pick_reference_score_column(ref_df, prediction_col):
        return Response(
            content=f"Upload missing prediction column '{prediction_col}' selected at ingestion",
            status_code=400,
        )

    try:
        comparison_df, summary = build_score_comparison(
            platform_path, ref_path, reference_score_col=prediction_col
        )
        comparison_df = prepare_score_comparison_table(comparison_df)
    except Exception as exc:
        return Response(content=str(exc), status_code=400)

    sess_dir = session_dir(session_id)
    os.makedirs(sess_dir, exist_ok=True)
    if file_format == "xlsx":
        out_path = os.path.join(sess_dir, f"score_comparison_{dataset}.xlsx")
        comparison_df.to_excel(out_path, index=False)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        download_name = f"score_comparison_{dataset}.xlsx"
    else:
        out_path = session.get("score_comparison_path") or score_comparison_path(session_id, dataset)
        comparison_df.to_csv(out_path, index=False)
        media_type = "text/csv"
        download_name = f"score_comparison_{dataset}.csv"

    summary_path = os.path.join(sess_dir, f"score_comparison_{dataset}_summary.json")
    with open(summary_path, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    update_session(session_id, {
        f"score_comparison_{dataset}_path": out_path,
        f"score_comparison_{dataset}_summary": summary,
    })

    return FileResponse(
        out_path,
        media_type=media_type,
        filename=download_name,
    )


@router.get("/recalibration-training-data")
async def export_recalibration_training_data(
    session_id: str = Query(...),
    format: str = Query("csv", pattern="^(csv|parquet)$"),
):
    """Serve cached combined Existing Train + New Train used for recalibration (fast path)."""
    session = get_session(session_id)
    if not session:
        return Response(content="Session not found", status_code=404)

    parquet_path = ensure_recalibration_training_artifact(session_id, session)
    if not parquet_path:
        return Response(
            content="Recalibration training data not found. Complete Data Processing first.",
            status_code=404,
        )
    session = get_session(session_id) or session

    if format == "parquet":
        return FileResponse(
            parquet_path,
            media_type="application/octet-stream",
            filename="recalibration_training_data.parquet",
        )

    csv_path = session.get("processed_recal_train_csv_path") or processed_csv_path(session_id, "recal_train")
    if not os.path.exists(csv_path):
        pd.read_parquet(parquet_path).to_csv(csv_path, index=False)
        update_session(session_id, {"processed_recal_train_csv_path": csv_path})

    return FileResponse(csv_path, media_type="text/csv", filename="recalibration_training_data.csv")


@router.post("/feature-list")
async def export_feature_list(body: dict = Body(...)):
    """Export selected feature names as a single-sheet Excel workbook."""
    session_id = str(body.get("session_id") or "").strip()
    features = body.get("features") or []
    if not session_id:
        return Response(content="session_id required", status_code=400)
    session = get_session(session_id)
    if not session:
        return Response(content="Session not found", status_code=404)
    if not isinstance(features, list) or not features:
        return Response(content="features list required", status_code=400)
    clean = [str(f).strip() for f in features if str(f).strip()]
    if not clean:
        return Response(content="No valid feature names", status_code=400)

    sess_dir = session_dir(session_id)
    os.makedirs(sess_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    out_path = os.path.join(sess_dir, f"final_feature_list_{stamp}.xlsx")
    pd.DataFrame({"feature": clean}).to_excel(out_path, index=False, sheet_name="Features")

    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="final_feature_list.xlsx",
    )


@router.get("/processing-workbook")
async def export_processing_workbook(
    session_id: str = Query(...),
    dataset: str = Query("dev", pattern="^(dev|new)$"),
    reference_path: str | None = Query(default=None),
):
    """Export score comparison and model features as a two-sheet Excel workbook."""
    session = get_session(session_id)
    if not session:
        return Response(content="Session not found", status_code=404)

    repro = session.get("reproducibility_result") or {}
    features = repro.get("model_features_used") or []
    features_df = pd.DataFrame({"#": range(1, len(features) + 1), "feature": features})

    comparison_df = pd.DataFrame()
    path = (
        session.get(f"score_comparison_{dataset}_path")
        or repro.get("score_comparison_path")
        or score_comparison_path(session_id, dataset)
    )
    if path and os.path.exists(path):
        comparison_df = prepare_score_comparison_table(pd.read_csv(path))
    else:
        platform_path = _resolve_processed_path(session, dataset)
        prediction_col = resolve_prediction_column(session)
        ref_path = reference_path or resolve_upload_reference_path(session, dataset)
        if (
            prediction_col
            and platform_path
            and os.path.exists(platform_path)
            and ref_path
            and os.path.exists(ref_path)
            and pick_reference_score_column(read_tabular_dataframe(ref_path), prediction_col)
        ):
            try:
                comparison_df, _ = build_score_comparison(
                    platform_path, ref_path, reference_score_col=prediction_col
                )
                comparison_df = prepare_score_comparison_table(comparison_df)
            except Exception:
                comparison_df = pd.DataFrame()

    sess_dir = session_dir(session_id)
    os.makedirs(sess_dir, exist_ok=True)
    out_path = os.path.join(sess_dir, f"data_processing_{dataset}.xlsx")
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        comparison_df.to_excel(writer, sheet_name="Score Comparison", index=False)
        features_df.to_excel(writer, sheet_name="Model Features", index=False)

    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"data_processing_{dataset}.xlsx",
    )


@router.post("/reference-predictions")
async def set_reference_predictions(body: dict):
    """Deprecated: score comparison uses the prediction column selected at ingestion."""
    return {
        "ok": False,
        "error": "External reference files are not used; select a prediction column on the Ingestion page.",
    }
