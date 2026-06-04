from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict
from pydantic import BaseModel, Field, create_model
from langchain_core.tools import StructuredTool


ToolFn = Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]]


@dataclass
class ToolSpec:
    name: str
    description: str
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]
    idempotent: bool = True
    side_effects: bool = False
    fn: ToolFn | None = None


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def schema_snapshot(self) -> Dict[str, Dict[str, Any]]:
        return {
            name: {
                "description": spec.description,
                "input_schema": spec.input_schema,
                "output_schema": spec.output_schema,
                "idempotent": spec.idempotent,
                "side_effects": spec.side_effects,
            }
            for name, spec in self._tools.items()
        }

    async def execute(self, session_id: str, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        spec = self._tools.get(name)
        if spec is None or spec.fn is None:
            raise ValueError(f"Unknown tool: {name}")
        return await spec.fn(session_id, args)

    def as_langchain_tools(self, session_id: str) -> Dict[str, StructuredTool]:
        tools: Dict[str, StructuredTool] = {}
        for name, spec in self._tools.items():
            if spec.fn is None:
                continue
            args_model = self._args_model_for_spec(name, spec)

            async def _run_tool(_spec: ToolSpec = spec, **kwargs: Any) -> Dict[str, Any]:
                assert _spec.fn is not None
                return await _spec.fn(session_id, kwargs)

            tools[name] = StructuredTool.from_function(
                coroutine=_run_tool,
                name=name,
                description=spec.description,
                args_schema=args_model,
            )
        return tools

    @staticmethod
    def _args_model_for_spec(name: str, spec: ToolSpec) -> type[BaseModel]:
        props = (spec.input_schema or {}).get("properties") or {}
        fields: Dict[str, tuple[Any, Any]] = {}
        for key in props.keys():
            fields[key] = (Any, Field(default=None))
        if not fields:
            fields = {"payload": (Any, Field(default=None))}
        return create_model(f"{name.title().replace('_', '')}Args", **fields)  # type: ignore[arg-type]


async def passthrough_tool(_: str, args: Dict[str, Any]) -> Dict[str, Any]:
    # Keeps deterministic fallback behavior when a specialist does not yet
    # have fine-grained tool extraction.
    await asyncio.sleep(0)
    return {"ok": True, "args": args}
