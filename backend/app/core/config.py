"""Environment and LiteLLM configuration for future narrative / insight calls."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None  # type: ignore

try:
    import litellm

    litellm.drop_params = True
except ImportError:  # pragma: no cover
    litellm = None  # type: ignore

DEFAULT_CHAT_MODEL = "gpt-4.1-mini"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


def _find_dotenv() -> Optional[Path]:
    """Search backend/.env then project root .env."""
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / ".env",  # backend/.env
        here.parents[3] / ".env",  # project root
        Path.cwd() / ".env",
        Path.cwd() / "backend" / ".env",
    ]
    seen: set[Path] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        if path.is_file():
            return path
    return None


if load_dotenv is not None:
    _env_file = _find_dotenv()
    if _env_file:
        load_dotenv(_env_file)


def _env_clean(key: str) -> Optional[str]:
    raw = os.getenv(key)
    if raw is None:
        return None
    cleaned = raw.strip()
    if len(cleaned) >= 2 and cleaned[0] in {"'", '"'} and cleaned[-1] == cleaned[0]:
        cleaned = cleaned[1:-1]
    return cleaned or None


def _clean_env_value(value: str) -> str:
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] in {"'", '"'} and cleaned[-1] == cleaned[0]:
        cleaned = cleaned[1:-1]
    return cleaned


def _parse_env_value(value: str) -> Any:
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    return value


def _collect_env_vars(prefixes: Iterable[str]) -> Dict[str, str]:
    vars_map: Dict[str, str] = {}
    seen_keys: set[str] = set()
    for prefix in prefixes:
        normalized = prefix.strip().upper()
        if not normalized:
            continue
        marker = normalized + "_"
        allow_nested = "_" in normalized
        for key, value in os.environ.items():
            key_upper = key.upper()
            if key_upper in seen_keys:
                continue
            if not key_upper.startswith(marker):
                continue
            suffix = key_upper[len(marker) :]
            if not allow_nested and "_" in suffix:
                continue
            cleaned = _clean_env_value(value)
            if cleaned:
                vars_map[suffix] = cleaned
                seen_keys.add(key_upper)
    return vars_map


_LLM_USE_GATEWAY_RAW = os.getenv("LLM_USE_GATEWAY")
LLM_USE_GATEWAY: bool = (
    str(_LLM_USE_GATEWAY_RAW).strip().lower() in {"1", "true", "yes", "on"}
    if _LLM_USE_GATEWAY_RAW is not None and str(_LLM_USE_GATEWAY_RAW).strip()
    else False
)
_LLM_GATEWAY_FALLBACK_RAW = os.getenv("LLM_GATEWAY_FALLBACK")
LLM_GATEWAY_FALLBACK: bool = (
    str(_LLM_GATEWAY_FALLBACK_RAW).strip().lower() in {"1", "true", "yes", "on"}
    if _LLM_GATEWAY_FALLBACK_RAW is not None and str(_LLM_GATEWAY_FALLBACK_RAW).strip()
    else False
)
LLM_GATEWAY_URL: Optional[str] = _env_clean("LLM_GATEWAY_URL")
LLM_GATEWAY_VIRTUAL_KEY: Optional[str] = _env_clean("LLM_GATEWAY_VIRTUAL_KEY")


def gateway_credentials_configured() -> bool:
    return bool(LLM_GATEWAY_URL and LLM_GATEWAY_VIRTUAL_KEY)


def gateway_only_mode() -> bool:
    """Legacy: route all chat calls through the gateway (no direct Azure attempt)."""
    return bool(LLM_USE_GATEWAY and gateway_credentials_configured() and not LLM_GATEWAY_FALLBACK)


def gateway_enabled() -> bool:
    """True when gateway credentials exist (fallback or gateway-only mode)."""
    return gateway_credentials_configured()


def normalize_azure_openai_endpoint(
    provider: str,
    api_base: Optional[str],
    api_version: Optional[str],
) -> tuple[str, Optional[str], Optional[str]]:
    """
    Azure AI Foundry OpenAI-compatible ``/openai/v1`` bases must use the OpenAI
    provider in LiteLLM. Classic ``*.openai.azure.com`` resources use ``azure``.
    """
    if not api_base:
        return provider, api_base, api_version
    base = api_base.rstrip("/")
    if provider.lower().startswith("azure") and "/openai/v1" in base:
        return "openai", base, None
    return provider, api_base, api_version


def direct_azure_chat_env() -> Dict[str, Optional[str]]:
    """Shared direct-Azure chat credentials/endpoints from env."""
    return {
        "api_key": _env_clean("LLM_CHAT_API_KEY")
        or _env_clean("AZURE_OPENAI_API_KEY")
        or _env_clean("API_KEY"),
        "api_base": _env_clean("LLM_CHAT_API_BASE")
        or _env_clean("ENDPOINT")
        or _env_clean("AZURE_OPENAI_ENDPOINT"),
        "api_version": _env_clean("LLM_CHAT_API_VERSION")
        or _env_clean("AZURE_API_VERSION")
        or "2025-01-01-preview",
        "model": _env_clean("LLM_CHAT_MODEL")
        or _env_clean("AZURE_OPENAI_DEPLOYMENT_NAME")
        or _env_clean("MODEL"),
    }


def _normalize_bedrock_model(provider: str, model: Optional[str]) -> Optional[str]:
    if not model:
        return model
    if provider.lower() != "bedrock":
        return model
    cleaned = model.strip()
    if not cleaned:
        return cleaned
    if cleaned.startswith("bedrock/"):
        return cleaned
    if cleaned.startswith("converse/"):
        return f"bedrock/{cleaned}"
    return f"bedrock/{cleaned}"


@dataclass
class LitellmUsageConfig:
    name: str
    provider: str
    model: str
    custom_provider: Optional[str]
    api_base: Optional[str]
    api_key: Optional[str]
    api_version: Optional[str]
    defaults: Dict[str, Any] = field(default_factory=dict)
    route: str = "direct"

    @classmethod
    def from_mapping(
        cls,
        name: str,
        usage_type: str,
        model_id: str,
        mapping: Dict[str, Any],
        model_normalizer: Optional[Callable[[str, Optional[str]], Optional[str]]] = None,
        *,
        use_gateway: bool = False,
    ) -> "LitellmUsageConfig":
        provider = (mapping.get("provider") or "openai").strip().lower()
        model = mapping.get("model") or model_id
        api_base = mapping.get("api_base")
        api_version = mapping.get("api_version")

        defaults: Dict[str, Any] = {}
        for key, value in mapping.items():
            if key in {"provider", "model", "api_base", "api_version", "gateway_model_id", "tags"}:
                continue
            if value is not None:
                defaults[key] = _parse_env_value(str(value))

        api_key = mapping.get("api_key")
        if usage_type == "chat":
            azure_env = direct_azure_chat_env()
            if not api_key and provider.startswith("azure"):
                api_key = azure_env["api_key"]
            if not api_base and provider.startswith("azure"):
                api_base = azure_env["api_base"]
            if not api_version and provider.startswith("azure"):
                api_version = azure_env["api_version"]
        elif not api_key and provider.startswith("azure"):
            api_key = os.getenv("LLM_EMBEDDING_API_KEY") or os.getenv("LLM_API_KEY")

        provider, api_base, api_version = normalize_azure_openai_endpoint(
            provider, api_base, api_version
        )

        normalized_model = model
        if model_normalizer:
            normalized_model = model_normalizer(provider, model)

        cfg = cls(
            name=name,
            provider=provider,
            model=normalized_model or model_id,
            custom_provider=provider,
            api_base=api_base,
            api_key=api_key,
            api_version=api_version,
            defaults=defaults,
            route="direct",
        )
        gateway_model_id = mapping.get("gateway_model_id")
        if use_gateway and gateway_model_id and gateway_credentials_configured():
            cfg.apply_gateway(LLM_GATEWAY_URL, LLM_GATEWAY_VIRTUAL_KEY, str(gateway_model_id))
        return cfg

    @classmethod
    def from_env(
        cls,
        name: str,
        prefixes: Iterable[str],
        default_provider: str,
        default_model: str,
        fallback_map: Optional[Dict[str, Optional[str]]] = None,
        model_normalizer: Optional[Callable[[str, Optional[str]], Optional[str]]] = None,
    ) -> "LitellmUsageConfig":
        env_vars = _collect_env_vars(prefixes)
        provider = (env_vars.pop("PROVIDER", None) or default_provider or "openai").lower()
        model = env_vars.pop("MODEL", None)
        if not model and fallback_map:
            model = fallback_map.get("model")
        if not model:
            model = default_model

        api_base = env_vars.pop("API_BASE", None)
        api_key = env_vars.pop("API_KEY", None)
        api_version = env_vars.pop("API_VERSION", None)
        gateway_model_id_env = env_vars.pop("GATEWAY_MODEL_ID", None)

        if fallback_map:
            api_base = api_base or fallback_map.get("api_base")
            api_key = api_key or fallback_map.get("api_key")
            api_version = api_version or fallback_map.get("api_version")

        provider, api_base, api_version = normalize_azure_openai_endpoint(
            provider, api_base, api_version
        )

        cleaned_defaults = {
            key.lower(): _parse_env_value(value)
            for key, value in env_vars.items()
            if value is not None
        }

        normalized_model = model
        if model_normalizer:
            normalized_model = model_normalizer(provider, model)

        cfg = cls(
            name=name,
            provider=provider,
            model=normalized_model or default_model,
            custom_provider=provider,
            api_base=api_base,
            api_key=api_key,
            api_version=api_version,
            defaults=cleaned_defaults,
        )
        if gateway_only_mode() and gateway_model_id_env and gateway_credentials_configured():
            cfg.apply_gateway(LLM_GATEWAY_URL, LLM_GATEWAY_VIRTUAL_KEY, str(gateway_model_id_env))
        return cfg

    def apply_gateway(self, gateway_url: str, virtual_key: str, gateway_model_id: str) -> "LitellmUsageConfig":
        self.provider = "openai"
        self.custom_provider = "openai"
        self.model = f"openai/{gateway_model_id}"
        self.api_base = f"{gateway_url.rstrip('/')}/v1"
        self.api_key = virtual_key
        self.api_version = None
        self.route = "gateway"
        return self

    def build_request_kwargs(self) -> Dict[str, Any]:
        base = {
            "model": self.model,
            "custom_llm_provider": self.custom_provider,
            "api_base": self.api_base,
            "api_key": self.api_key,
            "api_version": self.api_version,
        }
        cleaned = {k: v for k, v in base.items() if v}
        extra = {
            k: v
            for k, v in self.defaults.items()
            if k not in {"model", "custom_llm_provider", "api_base", "api_key", "api_version"}
        }
        cleaned.update(extra)
        return cleaned

    def is_ready(self) -> bool:
        if litellm is None:
            return False
        if self.route == "gateway":
            return bool(self.model and self.api_key and self.api_base)
        if self.provider.startswith("azure") or self.provider == "openai":
            return bool(self.model and self.api_key and self.api_base)
        return bool(self.model)


class Settings:
    LLM_USE_GATEWAY: bool = LLM_USE_GATEWAY
    LLM_GATEWAY_FALLBACK: bool = LLM_GATEWAY_FALLBACK
    LLM_GATEWAY_URL: Optional[str] = LLM_GATEWAY_URL
    LLM_GATEWAY_VIRTUAL_KEY: Optional[str] = LLM_GATEWAY_VIRTUAL_KEY

    BEDROCK_CHAT_MODEL: Optional[str] = os.getenv("BEDROCK_AWS_MODEL")
    BEDROCK_EMBEDDING_MODEL: Optional[str] = os.getenv("BEDROCK_AWS_EMBEDDING_MODEL")

    CHAT_LLM_CONFIG: LitellmUsageConfig = LitellmUsageConfig.from_env(
        name="chat",
        prefixes=["LLM_CHAT", "LLM"],
        default_provider=os.getenv("LLM_PROVIDER", "azure"),
        default_model=os.getenv("LLM_MODEL", os.getenv("MODEL", DEFAULT_CHAT_MODEL)),
        fallback_map={
            "api_base": os.getenv("ENDPOINT") or os.getenv("AZURE_OPENAI_ENDPOINT"),
            "api_key": os.getenv("API_KEY") or os.getenv("AZURE_OPENAI_API_KEY"),
            "api_version": os.getenv("AZURE_API_VERSION", "2025-01-01-preview"),
            "model": BEDROCK_CHAT_MODEL
            or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
            or os.getenv("MODEL"),
        },
        model_normalizer=_normalize_bedrock_model,
    )

    EMBEDDING_LLM_CONFIG: LitellmUsageConfig = LitellmUsageConfig.from_env(
        name="embedding",
        prefixes=["LLM_EMBEDDING", "EMBEDDING"],
        default_provider=os.getenv("EMBEDDING_PROVIDER", "azure"),
        default_model=os.getenv("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL),
        fallback_map={
            "api_base": os.getenv("EMBEDDING_ENDPOINT"),
            "api_key": os.getenv("API_KEY_EMBEDDING", os.getenv("API_KEY")),
            "api_version": os.getenv("EMBEDDING_API_VERSION", os.getenv("AZURE_API_VERSION")),
            "model": BEDROCK_EMBEDDING_MODEL or os.getenv("EMBEDDING_MODEL"),
        },
        model_normalizer=_normalize_bedrock_model,
    )

    def apply_provider_environment(self, provider: str, config: Optional[LitellmUsageConfig] = None) -> None:
        """Set provider-specific env vars before LiteLLM calls (Azure, etc.)."""
        provider_l = (provider or "").lower()
        active = config or self.CHAT_LLM_CONFIG
        if provider_l.startswith("azure") and active.api_key:
            os.environ.setdefault("AZURE_API_KEY", active.api_key)
            if active.api_base:
                os.environ.setdefault("AZURE_API_BASE", active.api_base)


settings = Settings()
