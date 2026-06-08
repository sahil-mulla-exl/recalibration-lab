#!/usr/bin/env python3
"""
Smoke-test LLM configuration from backend/.env.

Usage (from repo root or backend/):
  python backend/scripts/test_llm_connection.py
  python backend/scripts/test_llm_connection.py --context drift_diagnostics
  python backend/scripts/test_llm_connection.py --model gpt-4.1-mini --routes-only

Exits 0 when at least one route succeeds; 1 when all configured routes fail.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any

# Allow `from backend.app...` when run as a file script.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(_BACKEND_ROOT)
for path in (_REPO_ROOT, _BACKEND_ROOT):
    if path not in sys.path:
        sys.path.insert(0, path)


def _mask_secret(value: str | None, visible: int = 4) -> str:
    if not value:
        return "(not set)"
    cleaned = value.strip()
    if len(cleaned) <= visible * 2:
        return "*" * len(cleaned)
    return f"{cleaned[:visible]}...{cleaned[-visible:]}"


def _print_env_summary() -> None:
    from backend.app.core.config import (
        LLM_GATEWAY_FALLBACK,
        LLM_USE_GATEWAY,
        direct_azure_chat_env,
        gateway_credentials_configured,
        settings,
    )

    azure = direct_azure_chat_env()
    print("=== LLM environment (secrets masked) ===")
    print(f"  LLM_CHAT_API_KEY:          {_mask_secret(azure.get('api_key'))}")
    print(f"  LLM_CHAT_API_BASE:         {azure.get('api_base') or '(not set)'}")
    print(f"  LLM_CHAT_API_VERSION:      {azure.get('api_version') or '(not set)'}")
    print(f"  LLM_CHAT_MODEL:            {azure.get('model') or '(not set)'}")
    print(f"  AZURE_OPENAI_ENDPOINT:     {os.getenv('AZURE_OPENAI_ENDPOINT', '(not set)')}")
    print(f"  AZURE_OPENAI_DEPLOYMENT:   {os.getenv('AZURE_OPENAI_DEPLOYMENT_NAME', '(not set)')}")
    print(f"  LLM_GATEWAY_FALLBACK:      {LLM_GATEWAY_FALLBACK}")
    print(f"  LLM_USE_GATEWAY:           {LLM_USE_GATEWAY}")
    print(f"  LLM_GATEWAY_URL:           {os.getenv('LLM_GATEWAY_URL', '(not set)')}")
    print(f"  LLM_GATEWAY_VIRTUAL_KEY:   {_mask_secret(os.getenv('LLM_GATEWAY_VIRTUAL_KEY'))}")
    print(f"  gateway_credentials:       {gateway_credentials_configured()}")
    print(f"  CHAT_LLM_CONFIG ready:     {settings.CHAT_LLM_CONFIG.is_ready()}")
    print(f"  llm_service ready:         ", end="")


def _print_route_plan(model_id: str) -> None:
    from backend.app.core.llm_registry import resolve_model_routes
    from backend.app.services.llm_service import route_display_label

    direct, gateway = resolve_model_routes(model_id, usage="chat")
    print("\n=== Resolved routes ===")
    for label, cfg in (("direct-azure", direct), ("gateway-fallback", gateway)):
        if cfg is None:
            print(f"  {label}: (not configured)")
            continue
        kwargs = cfg.build_request_kwargs()
        print(f"  {label} ({route_display_label(label)}):")
        print(f"    provider:   {cfg.provider}")
        print(f"    model:      {kwargs.get('model')}")
        print(f"    api_base:   {kwargs.get('api_base')}")
        print(f"    api_version:{kwargs.get('api_version')}")
        print(f"    ready:      {cfg.is_ready()}")


def _attempt_route(cfg: Any, route: str, prompt: str, max_tokens: int) -> tuple[bool, str, float]:
    from backend.app.core.config import settings
    from backend.app.services.llm_service import LLMService, route_display_label

    service = LLMService()
    t0 = time.perf_counter()
    try:
        settings.apply_provider_environment(cfg.provider, cfg)
        response = service._attempt_completion(
            cfg,
            {
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0,
            },
        )
        text = service._extract_response_text(response)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if not text:
            return False, "empty response", elapsed_ms
        preview = text.replace("\n", " ").strip()[:120]
        return True, f"{route_display_label(route)} OK — {preview!r}", elapsed_ms
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        return False, f"{route_display_label(route)} failed — {type(exc).__name__}: {exc}", elapsed_ms


def _test_routes_individually(model_id: str, prompt: str, max_tokens: int) -> int:
    from backend.app.core.llm_registry import resolve_model_routes
    from backend.app.services.llm_service import route_display_label

    direct, gateway = resolve_model_routes(model_id, usage="chat")
    attempts: list[tuple[str, Any]] = []
    if direct is not None and direct.is_ready():
        attempts.append(("direct-azure", direct))
    if gateway is not None and gateway.is_ready():
        attempts.append(("gateway-fallback", gateway))

    if not attempts:
        print("\nNo ready LLM routes found. Check backend/.env.")
        return 1

    print("\n=== Per-route probe ===")
    any_ok = False
    for route, cfg in attempts:
        ok, message, elapsed_ms = _attempt_route(cfg, route, prompt, max_tokens)
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {route_display_label(route)} ({elapsed_ms:.0f} ms)")
        print(f"         {message}")
        any_ok = any_ok or ok
    return 0 if any_ok else 1


def _test_service_fallback(context: str, prompt: str, max_tokens: int) -> int:
    from backend.app.services.llm_service import llm_service, route_display_label

    print("\n=== Service fallback chain ===")
    if not llm_service.is_ready():
        print("  llm_service.is_ready() = False")
        return 1

    t0 = time.perf_counter()
    try:
        text = llm_service.generate_text_sync(
            prompt,
            context=context,
            max_tokens=max_tokens,
            temperature=0,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        meta = llm_service.last_completion
        route = meta.route if meta else "unknown"
        model = meta.model_id if meta else "unknown"
        preview = text.replace("\n", " ").strip()[:160]
        print(f"  [PASS] context={context} route={route} display={route_display_label(route)} model={model}")
        print(f"         ({elapsed_ms:.0f} ms) response: {preview!r}")
        return 0
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        print(f"  [FAIL] ({elapsed_ms:.0f} ms) {type(exc).__name__}: {exc}")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Test LLM connectivity from backend/.env")
    parser.add_argument(
        "--context",
        default="drift_diagnostics",
        help="LLM routing context (default: drift_diagnostics)",
    )
    parser.add_argument(
        "--model",
        default="gpt-4.1-mini",
        help="Registry model id for per-route probes (default: gpt-4.1-mini)",
    )
    parser.add_argument(
        "--prompt",
        default="Reply with exactly: LLM connection OK",
        help="User prompt for the probe call",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=32,
        help="Max tokens for probe response (default: 32)",
    )
    parser.add_argument(
        "--routes-only",
        action="store_true",
        help="Only test direct-azure and gateway routes separately (skip service fallback)",
    )
    parser.add_argument(
        "--service-only",
        action="store_true",
        help="Only test llm_service fallback chain (skip per-route probes)",
    )
    args = parser.parse_args()

    # Import after sys.path is set; config loads backend/.env on import.
    from backend.app.services.llm_service import llm_service

    _print_env_summary()
    print(llm_service.is_ready())
    _print_route_plan(args.model)

    exit_code = 1
    if not args.service_only:
        exit_code = _test_routes_individually(args.model, args.prompt, args.max_tokens)
    if not args.routes_only:
        service_code = _test_service_fallback(args.context, args.prompt, args.max_tokens)
        exit_code = 0 if (exit_code == 0 or service_code == 0) else service_code

    print("\n=== Result ===")
    if exit_code == 0:
        print("  At least one LLM route succeeded.")
    else:
        print("  All LLM probes failed. Verify backend/.env and network access.")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
