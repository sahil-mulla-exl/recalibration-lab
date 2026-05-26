# Recalibration Lab

Restructured full-stack application with a Python backend and React/Vite frontend.

## Project Layout

- `backend/` - FastAPI backend (`backend/app` source, `backend/data`, `backend/scripts`)
- `frontend/` - React + Vite app (`frontend/src`, `frontend/public`, `frontend/dist`)
- `deploy/` - deployment manifests/scripts
- `docs/`, `testing/`, `logs/`, `output/` - operational folders

## Run

### Frontend (npm only)

```bash
npm run dev
```

This starts the frontend dev server from `frontend/`.

### Backend

```bash
python start.py
```

This starts FastAPI from `backend/app/main.py`.

## Build Frontend

```bash
npm run build
```
