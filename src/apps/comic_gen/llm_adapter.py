"""
LLM Adapter - Unified interface for DashScope and OpenAI-compatible APIs.

Supports two providers:
  - dashscope (default): Alibaba Cloud DashScope via OpenAI-compatible endpoint
  - openai: Any OpenAI-compatible API (OpenAI, DeepSeek, Ollama, etc.)

Configuration via environment variables:
  LLM_PROVIDER=dashscope|openai
  DASHSCOPE_API_KEY=...
  OPENAI_API_KEY=...
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_MODEL=gpt-4o
"""
import os
import logging
from typing import Dict, List, Optional, Any

from ...utils.endpoints import get_provider_base_url

logger = logging.getLogger(__name__)


class LLMAdapter:
    """Unified LLM call interface supporting DashScope and OpenAI-compatible APIs."""

    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "dashscope").lower()
        self._client = None
        self._client_config_key = None
        logger.info(f"LLM Adapter initialized with provider: {self.provider}")

    def _runtime_credentials(self) -> tuple[str | None, str | None]:
        """Resolve credentials for the current request context.

        Studio requests are owner-scoped.  Their UniArt credential must win
        over the process environment, otherwise a stale shared token can be
        used after login (and two users can accidentally share one client).
        Desktop/background calls without an authenticated Studio context keep
        the environment fallback for compatibility.
        """
        if self.provider == "openai":
            from ..studio_access import current_studio_user, runtime_uniart_for_owner

            user = current_studio_user()
            if user:
                try:
                    configured = runtime_uniart_for_owner(
                        user.user_id, user.owner_profile_id
                    )
                except Exception as exc:
                    raise RuntimeError(
                        "UniArt API key is not configured for the current user"
                    ) from exc
                api_key = (configured.get("api_key") or "").strip()
                base_url = (configured.get("base_url") or "").strip().rstrip("/")
                if not api_key:
                    raise RuntimeError(
                        "UniArt API key is not configured for the current user"
                    )
                return api_key, base_url or "https://uniart.fun/v1"
            return (
                os.getenv("OPENAI_API_KEY"),
                os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
            )
        return os.getenv("DASHSCOPE_API_KEY"), None

    @property
    def is_configured(self) -> bool:
        try:
            return bool(self._runtime_credentials()[0])
        except RuntimeError:
            return False

    def _get_client(self):
        """Get or create the OpenAI-compatible client (lazy, cached)."""
        api_key, configured_base_url = self._runtime_credentials()
        if self.provider == "openai":
            base_url = configured_base_url or "https://api.openai.com/v1"
        else:
            base_url = f"{get_provider_base_url('DASHSCOPE')}/compatible-mode/v1"
        config_key = (self.provider, api_key, base_url)
        if self._client is None or self._client_config_key != config_key:
            try:
                from openai import OpenAI
            except ImportError:
                raise RuntimeError(
                    "openai package not installed. Run: pip install openai>=1.0.0"
                )

            self._client = OpenAI(api_key=api_key, base_url=base_url)
            self._client_config_key = config_key
        return self._client

    # DashScope qwen 系列：首选 qwen3.7-plus（最新），不可用时回退到 qwen3.6-plus，
    # 最终回退到 qwen-plus alias（始终指向最新稳定通用版）。
    # 维护 fallback chain 而不是硬写一个名字，避免新版本上下线时整条 LLM 链断掉。
    _DASHSCOPE_MODEL_FALLBACK_CHAIN = ["qwen3.7-plus", "qwen3.6-plus", "qwen-plus"]

    def _get_default_model(self) -> str:
        if self.provider == "openai":
            return os.getenv("OPENAI_MODEL", "gpt-4o")
        return self._DASHSCOPE_MODEL_FALLBACK_CHAIN[0]

    def chat(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
        *,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> str:
        """
        Send a chat completion request and return the response content.

        Args:
            messages: List of {"role": ..., "content": ...} dicts
            model: Model name override (uses provider default if None)
            response_format: Optional {"type": "json_object"} constraint
            timeout_seconds: Optional per-request timeout. When omitted, the
                OpenAI client's default is used.
            max_retries: Optional per-request retry count. When omitted, the
                OpenAI client's default is used.

        Returns:
            The assistant's response content as a string.

        Raises:
            RuntimeError: If the API call fails.
        """
        client = self._get_client()

        # 显式 model override 路径：单次尝试，失败就抛。
        if model:
            return self._chat_once(
                client, model, messages, response_format,
                timeout_seconds=timeout_seconds, max_retries=max_retries,
            )

        # Provider 默认路径：DashScope 走 fallback chain，OpenAI 单次尝试。
        if self.provider == "openai":
            return self._chat_once(
                client, self._get_default_model(), messages, response_format,
                timeout_seconds=timeout_seconds, max_retries=max_retries,
            )

        last_err: Optional[Exception] = None
        for idx, candidate in enumerate(self._DASHSCOPE_MODEL_FALLBACK_CHAIN):
            try:
                return self._chat_once(
                    client, candidate, messages, response_format,
                    timeout_seconds=timeout_seconds, max_retries=max_retries,
                )
            except RuntimeError as e:
                # 仅在 "模型不存在 / 不可用" 类错误时回退；其他错误（鉴权、限流、网络）
                # 直接抛，不浪费第二次重试。判定关键字宽松匹配 DashScope 文案。
                msg = str(e).lower()
                is_model_unavailable = any(k in msg for k in (
                    "model not found", "invalidmodel", "model_not_found",
                    "no such model", "not supported", "modelnotfound", "404",
                ))
                last_err = e
                if is_model_unavailable and idx < len(self._DASHSCOPE_MODEL_FALLBACK_CHAIN) - 1:
                    next_candidate = self._DASHSCOPE_MODEL_FALLBACK_CHAIN[idx + 1]
                    logger.warning(
                        "DashScope model %s unavailable (%s); falling back to %s",
                        candidate, e, next_candidate,
                    )
                    continue
                raise
        # 理论上不可达（最后一次失败已 raise），保留兜底
        raise last_err if last_err else RuntimeError("DashScope: no models available")

    def _chat_once(
        self,
        client,
        model: str,
        messages: List[Dict[str, str]],
        response_format: Optional[Dict[str, str]],
        *,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> str:
        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
        }
        if response_format:
            kwargs["response_format"] = response_format

        try:
            request_client = client
            options: Dict[str, Any] = {}
            if timeout_seconds is not None:
                options["timeout"] = timeout_seconds
            if max_retries is not None:
                options["max_retries"] = max_retries
            if options and hasattr(client, "with_options"):
                request_client = client.with_options(**options)
            response = request_client.chat.completions.create(**kwargs)
            return response.choices[0].message.content
        except Exception as e:
            provider_label = "DashScope" if self.provider != "openai" else "OpenAI"
            raise RuntimeError(f"{provider_label} API error: {e}") from e
