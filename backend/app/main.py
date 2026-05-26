import os
from pathlib import Path
from contextlib import asynccontextmanager

from backend.app.core.config import settings as _llm_settings  # noqa: F401 — loads backend/.env

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    backend_root = Path(__file__).resolve().parents[1]
    data_dir = backend_root / "data"
    dev_sample_path = data_dir / "dev_sample.parquet"
    if not dev_sample_path.exists():
        print("Generating sample data on first start...")
        try:
            from backend.scripts.generate_sample_data import generate_all

            generate_all()
            print("Sample data generated.")
        except Exception as e:
            print(f"Warning: Could not generate sample data: {e}")
    yield

app = FastAPI(title="Recalibration Lab API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.app.api.session import router as session_router
from backend.app.api.inventory import router as inventory_router
from backend.app.api.workflow import router as workflow_router
from backend.app.api.ingestion import router as ingestion_router
from backend.app.api.agents import router as agents_router
from backend.app.api.diagnostics import router as diagnostics_router
from backend.app.api.governance import router as governance_router
from backend.app.api.recalibration import router as recalibration_router
from backend.app.api.evaluation import router as evaluation_router
from backend.app.api.export import router as export_router

app.include_router(session_router, prefix="/api/session")
app.include_router(inventory_router, prefix="/api/inventory")
app.include_router(workflow_router, prefix="/api/workflow")
app.include_router(ingestion_router, prefix="/api/ingestion")
app.include_router(agents_router, prefix="/api/agents")
app.include_router(diagnostics_router, prefix="/api/diagnostics")
app.include_router(governance_router, prefix="/api/governance")
app.include_router(recalibration_router, prefix="/api/recalibration")
app.include_router(evaluation_router, prefix="/api/evaluation")
app.include_router(export_router, prefix="/api/export")

@app.get("/api/healthz")
async def health():
    return {"status": "ok"}
