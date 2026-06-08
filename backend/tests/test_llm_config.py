from backend.app.core.config import LitellmUsageConfig, normalize_azure_openai_endpoint


def test_foundry_v1_endpoint_uses_openai_provider() -> None:
    provider, base, version = normalize_azure_openai_endpoint(
        "azure",
        "https://GEN-AI-COE-338946.services.ai.azure.com/openai/v1",
        "2025-01-01-preview",
    )
    assert provider == "openai"
    assert base == "https://GEN-AI-COE-338946.services.ai.azure.com/openai/v1"
    assert version is None


def test_classic_azure_endpoint_unchanged() -> None:
    provider, base, version = normalize_azure_openai_endpoint(
        "azure",
        "https://my-resource.openai.azure.com/",
        "2025-01-01-preview",
    )
    assert provider == "azure"
    assert version == "2025-01-01-preview"


def test_from_mapping_applies_foundry_normalization(monkeypatch) -> None:
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "test-key")
    monkeypatch.setenv(
        "AZURE_OPENAI_ENDPOINT",
        "https://example.services.ai.azure.com/openai/v1",
    )
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4.1-mini")

    cfg = LitellmUsageConfig.from_mapping(
        name="gpt-4.1-mini",
        usage_type="chat",
        model_id="gpt-4.1-mini",
        mapping={"provider": "azure", "model": "gpt-4.1-mini"},
    )
    assert cfg.provider == "openai"
    assert cfg.custom_provider == "openai"
    assert cfg.api_base == "https://example.services.ai.azure.com/openai/v1"
    assert cfg.api_version is None
