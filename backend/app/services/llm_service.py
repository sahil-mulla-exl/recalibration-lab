"""LiteLLM chat service with context routing — for future agent narratives."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from backend.app.core.config import LitellmUsageConfig, gateway_enabled, settings
from backend.app.core.llm_prompts import get_prompt_profile
from backend.app.core.llm_registry import resolve_model_config
from backend.app.core.llm_routing import candidates_for

try:
    from litellm import completion
except ImportError:  # pragma: no cover
    completion = None  # type: ignore

_router_logger = logging.getLogger("rcl.llm.router")
_logger = logging.getLogger(__name__)


def _build_litellm_kwargs(config: LitellmUsageConfig, overrides: Dict[str, Any]) -> Dict[str, Any]:
    merged = config.build_request_kwargs()
    merged.update(overrides)
    return {k: v for k, v in merged.items() if v is not None}


class LLMService:
    """Context-routed chat completions. Disabled until LLM_ENABLED=true and credentials are set."""

    def __init__(self) -> None:
        self.chat_config: LitellmUsageConfig = settings.CHAT_LLM_CONFIG

    def is_ready(self) -> bool:
        if completion is None:
            return False
        if gateway_enabled():
            return True
        if self.chat_config.is_ready():
            return True
        return any(
            (cfg := resolve_model_config(mid)) is not None and cfg.is_ready()
            for mid in candidates_for("default_chat")
        )

    def _build_config_for(self, model_id: str) -> Optional[LitellmUsageConfig]:
        resolved = resolve_model_config(model_id, usage="chat")
        if resolved is not None:
            return resolved
        if model_id == settings.CHAT_LLM_CONFIG.model:
            return settings.CHAT_LLM_CONFIG
        return None

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

    def _execute_with_fallback(
        self,
        context: str,
        overrides: Dict[str, Any],
    ) -> Tuple[Any, str]:
        if completion is None:
            raise RuntimeError("litellm is not installed")

        gw_on = gateway_enabled()
        candidates = candidates_for(context)
        t0 = __import__("time").perf_counter()
        last_exc: Optional[BaseException] = None

        if not candidates:
            config = settings.CHAT_LLM_CONFIG
            if not config.is_ready():
                raise RuntimeError(
                    f"No routable candidates for context={context} and env chat config is incomplete"
                )
            settings.apply_provider_environment(config.provider)
            request_kwargs = _build_litellm_kwargs(config, overrides)
            self._sanitize_sampling_params(request_kwargs)
            response = completion(**request_kwargs)
            _router_logger.info(
                "context=%s model=%s gateway=%s status=success source=env-fallback",
                context,
                config.model,
                gw_on,
            )
            return response, config.model

        for attempt, model_id in enumerate(candidates, start=1):
            cfg = self._build_config_for(model_id)
            if cfg is None or not cfg.is_ready():
                _router_logger.warning(
                    "context=%s attempt=%d model=%s status=skipped",
                    context,
                    attempt,
                    model_id,
                )
                continue
            try:
                settings.apply_provider_environment(cfg.provider)
                request_kwargs = _build_litellm_kwargs(cfg, overrides)
                self._sanitize_sampling_params(request_kwargs)
                response = completion(**request_kwargs)
                if self._response_is_empty(response):
                    raise RuntimeError("empty response")
                _router_logger.info(
                    "context=%s attempt=%d model=%s gateway=%s status=success duration_ms=%.0f",
                    context,
                    attempt,
                    model_id,
                    gw_on,
                    (__import__("time").perf_counter() - t0) * 1000,
                )
                self.chat_config = cfg
                return response, model_id
            except Exception as exc:
                last_exc = exc
                _router_logger.warning(
                    "context=%s attempt=%d model=%s status=failed error=%s",
                    context,
                    attempt,
                    model_id,
                    type(exc).__name__,
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
            return "LLM is not configured. Set LLM_USE_GATEWAY or LLM_CHAT_API_KEY in backend/.env"

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
