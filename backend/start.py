import argparse
import os
import sys
from pathlib import Path

import uvicorn


def _bool_from_env(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def main() -> None:
    backend_root = Path(__file__).resolve().parent
    project_root = backend_root.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    parser = argparse.ArgumentParser(
        description="Start Recalibration Lab FastAPI backend.",
    )
    parser.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8085")))
    parser.add_argument(
        "--reload",
        action=argparse.BooleanOptionalAction,
        default=_bool_from_env(os.getenv("RELOAD"), default=True),
        help="Enable or disable auto-reload (default: enabled).",
    )
    parser.add_argument(
        "--reload-dir",
        dest="reload_dirs",
        action="append",
        help="Directory to watch for reloads. Can be used multiple times.",
    )
    args = parser.parse_args()

    reload_dirs = args.reload_dirs or [
        str(backend_root / "app" / "api"),
        str(backend_root / "app" / "services"),
        str(backend_root / "app" / "utils"),
        str(backend_root / "scripts"),
        str(backend_root / "app" / "main.py"),
    ]

    print(
        f"[startup] Launching backend on http://{args.host}:{args.port} "
        f"(reload={'on' if args.reload else 'off'})",
        flush=True,
    )
    if args.reload:
        print(
            f"[startup] Watching {len(reload_dirs)} path(s) for reload:",
            flush=True,
        )
        for watched in reload_dirs:
            print(f"  - {watched}", flush=True)

    uvicorn.run(
        "backend.app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        reload_dirs=reload_dirs if args.reload else None,
    )


if __name__ == "__main__":
    main()
