import os

import csv

import io

import random

from fastapi import APIRouter, UploadFile, File

from backend.app.utils.session import get_session, update_session



router = APIRouter()



DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")



DRIFT_VERDICTS = {

    "MKT-CARD-RESP-023": "recalibrate",  # hardcoded per spec

    "MKT-LOAN-PROP-018": "watch",

    "MKT-MTG-XSELL-031": "hold",

    "MKT-AUTO-RESP-021": "watch",

    "INS-CHURN-040": "hold",

    "MKT-CC-ACT-014": "watch",

}





def _normalize_optimization_method(value: str | None) -> str:

    if not value:

        return "random"

    v = value.strip().lower().replace(" ", "_").replace("-", "_")

    aliases = {

        "random": "random",

        "random_search": "random",

        "bayesian": "bayesian",

        "bayesian_search": "bayesian",

        "tpe": "bayesian",

        "grid": "grid",

        "grid_search": "grid",

    }

    return aliases.get(v, "random")





def _extract_optimization_method(row: dict) -> str:

    for key in row:

        if key.strip().lower().replace(" ", "_") == "optimization_method":

            return _normalize_optimization_method(row.get(key))

    return "random"





def _enrich_model(model: dict) -> dict:

    model_id = model.get("model_id", "")

    if not model.get("problem_type"):

        model["problem_type"] = "classification"

    model["optimization_method"] = _extract_optimization_method(model)

    verdict = DRIFT_VERDICTS.get(model_id)

    if not verdict:

        # stub heuristic

        h = hash(model_id) % 3

        verdict = ["hold", "watch", "recalibrate"][h]

    model["drift_verdict"] = verdict

    return model





@router.get("/sample")

async def get_sample_inventory():

    sample_path = os.path.join(DATA_DIR, "sample_inventory.csv")

    models = []

    if os.path.exists(sample_path):

        with open(sample_path, "r") as f:

            reader = csv.DictReader(f)

            for row in reader:

                models.append(_enrich_model({k.strip(): v.strip() for k, v in row.items()}))

    return {

        "models": models,

        "count": len(models),

        "source": "sample",

    }





@router.post("/upload")

async def upload_inventory(file: UploadFile = File(...)):

    content = await file.read()

    reader = csv.DictReader(io.StringIO(content.decode("utf-8")))

    models = []

    schema_errors = []

    required_cols = ["model_name", "model_id", "model_class"]

    for i, row in enumerate(reader):

        row_clean = {k.strip(): v.strip() for k, v in row.items()}

        missing = [c for c in required_cols if c not in row_clean or not row_clean[c]]

        if missing:

            schema_errors.append({"row": i + 2, "missing": missing})

        else:

            models.append(_enrich_model(row_clean))

    return {

        "models": models,

        "count": len(models),

        "schema_errors": schema_errors,

        "filename": file.filename,

    }

