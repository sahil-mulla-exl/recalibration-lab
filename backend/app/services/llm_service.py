"""LiteLLM chat service with context routing — for future agent narratives."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from backend.app.core.config import (
    LitellmUsageConfig,
    gateway_credentials_configured,
    gateway_only_mode,
    settings,
)
from backend.app.core.llm_prompts import get_prompt_profile
from backend.app.core.llm_registry import resolve_model_config_gateway, resolve_model_routes
from backend.app.core.llm_routing import candidates_for

try:
    from litellm import completion
except ImportError:  # pragma: no cover
    completion = None  # type: ignore

_router_logger = logging.getLogger("rcl.llm.router")
_logger = logging.getLogger(__name__)

ROUTE_DISPLAY_LABELS: Dict[str, str] = {
    "direct-azure": "primary (direct Azure)",
    "gateway-fallback": "Exlerate gateway fallback",
    "gateway": "Exlerate gateway",
}


@dataclass(frozen=True)
class LLMCompletionMeta:
    route: str
    model_id: str
    context: str

    @property
    def display_label(self) -> str:
        return ROUTE_DISPLAY_LABELS.get(self.route, self.route)


def route_display_label(route: str) -> str:
    return ROUTE_DISPLAY_LABELS.get(route, route)


def _build_litellm_kwargs(config: LitellmUsageConfig, overrides: Dict[str, Any]) -> Dict[str, Any]:
    merged = config.build_request_kwargs()
    merged.update(overrides)
    return {k: v for k, v in merged.items() if v is not None}


class LLMService:
    """Context-routed chat completions with direct Azure primary and optional gateway fallback."""

    def __init__(self) -> None:
        self.chat_config: LitellmUsageConfig = settings.CHAT_LLM_CONFIG
        self._last_completion: Optional[LLMCompletionMeta] = None

    @property
    def last_completion(self) -> Optional[LLMCompletionMeta]:
        return self._last_completion

    def is_ready(self) -> bool:
        if completion is None:
            return False
        if settings.CHAT_LLM_CONFIG.is_ready():
            return True
        if gateway_credentials_configured():
            return True
        return any(
            (direct := self._build_config_for(mid, route="direct")) is not None and direct.is_ready()
            or (
                (gateway := self._build_config_for(mid, route="gateway")) is not None
                and gateway.is_ready()
            )
            for mid in candidates_for("default_chat")
        )

    def _build_config_for(
        self,
        model_id: str,
        *,
        route: str = "direct",
    ) -> Optional[LitellmUsageConfig]:
        if route == "gateway":
            return resolve_model_config_gateway(model_id, usage="chat")
        direct, _gateway = resolve_model_routes(model_id, usage="chat")
        if direct is not None:
            return direct
        if model_id == settings.CHAT_LLM_CONFIG.model:
            return settings.CHAT_LLM_CONFIG
        return None

    def _route_attempts_for_model(self, model_id: str) -> List[Tuple[str, LitellmUsageConfig]]:
        direct, gateway = resolve_model_routes(model_id, usage="chat")
        if direct is None and model_id == settings.CHAT_LLM_CONFIG.model:
            direct = settings.CHAT_LLM_CONFIG

        attempts: List[Tuple[str, LitellmUsageConfig]] = []
        if gateway_only_mode():
            if gateway is not None and gateway.is_ready():
                attempts.append(("gateway", gateway))
            return attempts

        if direct is not None and direct.is_ready():
            attempts.append(("direct-azure", direct))
        if gateway is not None and gateway.is_ready():
            attempts.append(("gateway-fallback", gateway))
        return attempts

    @staticmethod
    def _sanitize_sampling_params(kwargs: Dict[str, Any]) -> None:
        if "temperature" in kwargs and "top_p" in kwargs:
            kwargs.pop("top_p", None)

    @staticmethod
    def _response_is_empty(response: Any) -> bool:
        try:
            message = response.choices[0].message
            content = getattr(message, "content", None)
            if isinstance(content, str) and content.strip():
                return False
            if content:
                return False
        except (AttributeError, IndexError, TypeError):
            pass
        return True

    @staticmethod
    def _extract_response_text(response: Any) -> str:
        try:
            message = response.choices[0].message
            raw = getattr(message, "content", "")
            if isinstance(raw, str):
                return raw.strip()
            if raw is None:
                return ""
            return str(raw).strip()
        except (AttributeError, IndexError, TypeError):
            return ""

    def _attempt_completion(
        self,
        cfg: LitellmUsageConfig,
        overrides: Dict[str, Any],
    ) -> Any:
        settings.apply_provider_environment(cfg.provider, cfg)
        request_kwargs = _build_litellm_kwargs(cfg, overrides)
        self._sanitize_sampling_params(request_kwargs)
        response = completion(**request_kwargs)
        if self._response_is_empty(response):
            raise RuntimeError("empty response")
        return response

    def _record_success(
        self,
        *,
        route: str,
        model_id: str,
        context: str,
        cfg: LitellmUsageConfig,
        attempt_idx: int,
        t0: float,
    ) -> None:
        self._last_completion = LLMCompletionMeta(route=route, model_id=model_id, context=context)
        self.chat_config = cfg
        label = route_display_label(route)
        _router_logger.info(
            "context=%s attempt=%d model=%s route=%s display=%s status=success duration_ms=%.0f",
            context,
            attempt_idx,
            model_id,
            route,
            label,
            (__import__("time").perf_counter() - t0) * 1000,
        )
        _logger.info(
            "LLM response via %s (model=%s, context=%s)",
            label,
            model_id,
            context,
        )

    def _execute_with_fallback(
        self,
        context: str,
        overrides: Dict[str, Any],
    ) -> Tuple[Any, str]:
        if completion is None:
            raise RuntimeError("litellm is not installed")

        candidates = candidates_for(context)
        t0 = __import__("time").perf_counter()
        last_exc: Optional[BaseException] = None

        if not candidates:
            attempts: List[Tuple[str, LitellmUsageConfig]] = []
            if gateway_only_mode():
                gw = resolve_model_config_gateway(settings.CHAT_LLM_CONFIG.model, usage="chat")
                if gw is not None and gw.is_ready():
                    attempts.append(("gateway", gw))
            elif settings.CHAT_LLM_CONFIG.is_ready():
                attempts.append(("direct-azure", settings.CHAT_LLM_CONFIG))
            elif gateway_credentials_configured():
                gw = resolve_model_config_gateway(settings.CHAT_LLM_CONFIG.model, usage="chat")
                if gw is not None and gw.is_ready():
                    attempts.append(("gateway-fallback", gw))

            for attempt_idx, (source, cfg) in enumerate(attempts, start=1):
                try:
                    response = self._attempt_completion(cfg, overrides)
                    self._record_success(
                        route=source,
                        model_id=cfg.model,
                        context=context,
                        cfg=cfg,
                        attempt_idx=attempt_idx,
                        t0=t0,
                    )
                    return response, cfg.model
                except Exception as exc:
                    last_exc = exc
                    _router_logger.warning(
                        "context=%s route=%s display=%s status=failed error=%s detail=%s",
                        context,
                        source,
                        route_display_label(source),
                        type(exc).__name__,
                        str(exc)[:300],
                    )

            raise RuntimeError(
                f"No routable candidates for context={context} and env chat config is incomplete"
            ) from last_exc

        for model_id in candidates:
            route_attempts = self._route_attempts_for_model(model_id)
            for attempt_idx, (source, cfg) in enumerate(route_attempts, start=1):
                try:
                    response = self._attempt_completion(cfg, overrides)
                    self._record_success(
                        route=source,
                        model_id=model_id,
                        context=context,
                        cfg=cfg,
                        attempt_idx=attempt_idx,
                        t0=t0,
                    )
                    return response, model_id
                except Exception as exc:
                    last_exc = exc
                    _router_logger.warning(
                        "context=%s attempt=%d model=%s route=%s display=%s status=failed error=%s detail=%s",
                        context,
                        attempt_idx,
                        model_id,
                        source,
                        route_display_label(source),
                        type(exc).__name__,
                        str(exc)[:300],
                    )

        raise RuntimeError(
            f"All candidate models failed for context={context}"
        ) from last_exc

    def _call_chat_completion(self, *, context: str = "default_chat", **overrides: Any) -> Any:
        response, _ = self._execute_with_fallback(context, overrides)
        return response

    def generate_text_sync(
        self,
        prompt: str,
        *,
        context: str = "default_chat",
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        system_prompt: Optional[str] = None,
    ) -> str:
        if not self.is_ready():
            return (
                "AI is not configured. Set LLM_CHAT_API_KEY and LLM_CHAT_API_BASE "
                "(or enable LLM_GATEWAY_FALLBACK with gateway credentials) in backend/.env"
            )

        profile = get_prompt_profile(context)
        max_t = max_tokens if max_tokens is not None else profile.max_tokens
        temp = temperature if temperature is not None else profile.temperature

        messages: List[Dict[str, Any]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        response = self._call_chat_completion(
            context=context,
            messages=messages,
            temperature=temp,
            max_tokens=max_t,
        )
        return self._extract_response_text(response)

    async def generate_text(
        self,
        prompt: str,
        *,
        context: str = "default_chat",
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        system_prompt: Optional[str] = None,
    ) -> str:
        return await asyncio.to_thread(
            self.generate_text_sync,
            prompt,
            context=context,
            max_tokens=max_tokens,
            temperature=temperature,
            system_prompt=system_prompt,
        )


llm_service = LLMService()
