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
import time
from typing import Dict, List, Optional, Any

from fastapi import HTTPException

from ...utils.endpoints import get_provider_base_url

logger = logging.getLogger(__name__)

LLM_CONTENT_REFUSAL_FINISH_REASONS = frozenset(("content_filter", "sensitive"))


class LLMResponseTerminationError(RuntimeError):
    """An explicit unsuccessful model finish, with no response prose exposed."""

    def __init__(self, finish_reason: str):
        self.finish_reason = finish_reason
        message = (f'所选模型拒绝处理本次内容（{finish_reason}）；请调整输入或切换剧本模型。'
                   if finish_reason in LLM_CONTENT_REFUSAL_FINISH_REASONS else
                   '模型输出达到长度上限（length），结果未完整生成；请缩小本次生成范围后重试。')
        super().__init__(message)


def get_script_writing_model() -> Optional[str]:
    """Resolve the shared model used by screenplay authoring operations."""
    return (
        os.getenv("SCRIPT_WRITING_MODEL")
        or os.getenv("SCRIPT_CONTINUATION_MODEL")
        or ""
    ).strip() or None


class LLMAdapter:
    """Unified LLM call interface supporting DashScope and OpenAI-compatible APIs."""

    def __init__(self, default_model: Optional[str] = None, *, use_script_model: bool = False):
        self.provider = os.getenv("LLM_PROVIDER", "dashscope").lower()
        self.default_model = default_model
        self.use_script_model = use_script_model
        self._client_cache = None
        logger.info(f"LLM Adapter initialized with provider: {self.provider}")

    def _runtime_credentials(self, gateway: Optional[str] = None) -> tuple[str | None, str | None]:
        """Resolve credentials for the current request context.

        Studio requests are owner-scoped. Their selected gateway must win
        over the process environment, otherwise a stale shared token can be
        used after login (and two users can accidentally share one client).
        Desktop/background calls without an authenticated Studio context keep
        the environment fallback for compatibility.
        """
        if gateway:
            from ..studio_access import studio_gateway_config

            config = studio_gateway_config(gateway)
            if gateway == "greena":
                from ...models.nsfw_new_one import gateway_config

                config = gateway_config(config)
            api_key = (config.get("api_key") or "").strip()
            base_url = (config.get("base_url") or "").strip().rstrip("/")
            if not api_key or not base_url:
                raise RuntimeError(f"{gateway} LLM credentials are not configured")
            return api_key, base_url
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
                        "LLM gateway API key is not configured for the current user"
                    ) from exc
                api_key = (configured.get("api_key") or "").strip()
                base_url = (configured.get("base_url") or "").strip().rstrip("/")
                if not api_key:
                    raise RuntimeError(
                        "LLM gateway API key is not configured for the current user"
                    )
                return api_key, base_url or "https://uniart.fun/v1"
            return (
                os.getenv("OPENAI_API_KEY"),
                os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
            )
        return os.getenv("DASHSCOPE_API_KEY"), None

    @property
    def is_configured(self) -> bool:
        return self.is_configured_for_model(None if self.use_script_model else self.default_model)

    @staticmethod
    def _model_gateway(model: Optional[str]) -> tuple[Optional[str], Optional[str]]:
        prefix, separator, raw_model = (model or "").partition("/")
        if separator and prefix in {"nsfw", "greena", "uniart"}:
            if not raw_model:
                raise ValueError("LLM model ID is empty")
            return ("greena" if prefix in {"nsfw", "greena"} else "uniart"), raw_model
        return None, model

    def is_configured_for_model(self, model: Optional[str]) -> bool:
        try:
            configured_model = model or (self._get_default_model() if self.use_script_model else self.default_model) or (
                self._get_default_model() if self.provider == "openai" else None
            )
            gateway, _ = self._model_gateway(configured_model)
            return bool(self._runtime_credentials(gateway)[0])
        except (RuntimeError, ValueError, HTTPException):
            return False

    def _get_client(self, *, gateway: Optional[str] = None):
        """Get or create the OpenAI-compatible client (lazy, cached)."""
        api_key, configured_base_url = self._runtime_credentials(gateway)
        if gateway or self.provider == "openai":
            base_url = configured_base_url or "https://api.openai.com/v1"
        else:
            base_url = f"{get_provider_base_url('DASHSCOPE')}/compatible-mode/v1"
        config_key = (gateway or self.provider, api_key, base_url)
        # Hold the matched key/client pair locally. Another worker may replace
        # the shared cache after comparison; it must not replace our result.
        cached = self._client_cache
        if cached is not None and cached[0] == config_key:
            return cached[1]
        try:
            from openai import OpenAI
        except ImportError:
            raise RuntimeError(
                "openai package not installed. Run: pip install openai>=1.0.0"
            )
        client = OpenAI(api_key=api_key, base_url=base_url)
        self._client_cache = (config_key, client)
        return client

    # DashScope qwen 系列：首选 qwen3.7-plus（最新），不可用时回退到 qwen3.6-plus，
    # 最终回退到 qwen-plus alias（始终指向最新稳定通用版）。
    # 维护 fallback chain 而不是硬写一个名字，避免新版本上下线时整条 LLM 链断掉。
    _DASHSCOPE_MODEL_FALLBACK_CHAIN = ["qwen3.7-plus", "qwen3.6-plus", "qwen-plus"]

    def _get_default_model(self) -> str:
        if self.use_script_model:
            from ..studio_access import studio_script_model

            selected = studio_script_model()
            if selected:
                return selected
            if self.default_model:
                return self.default_model
        if self.provider == "openai":
            return os.getenv("OPENAI_MODEL", "gpt-4o")
        return self._DASHSCOPE_MODEL_FALLBACK_CHAIN[0]

    def chat(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        response_format: Optional[Dict[str, str]] = None,
        *,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
        stream: bool = False,
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
            stream: Assemble streamed text into one response. Useful for long
                completions whose upstream does not promptly flush a final body.

        Returns:
            The assistant's response content as a string.

        Raises:
            RuntimeError: If the API call fails.
        """
        model = model or (self._get_default_model() if self.use_script_model else self.default_model) or (
            self._get_default_model() if self.provider == "openai" else None
        )
        gateway, model = self._model_gateway(model)
        client = self._get_client(gateway=gateway)
        logger.info("LLM route selected: gateway=%s model=%s", gateway or self.provider, model)

        # 显式 model override 路径：单次尝试，失败就抛。
        if model:
            try:
                return self._chat_once(
                    client, model, messages, response_format,
                    timeout_seconds=timeout_seconds, max_retries=max_retries, stream=stream,
                )
            except RuntimeError as exc:
                # UniArt occasionally returns a transient gateway 502 after
                # accepting a multimodal request. Retry once at this boundary
                # so callers keep the same model and reviewed input; payload
                # and authentication errors are still surfaced immediately.
                if "status=502" not in str(exc):
                    raise
                logger.warning("Transient LLM gateway 502; retrying model=%s once", model)
                time.sleep(1.0)
                return self._chat_once(
                    client, model, messages, response_format,
                    timeout_seconds=timeout_seconds, max_retries=0, stream=stream,
                )

        # Provider 默认路径：DashScope 走 fallback chain，OpenAI 单次尝试。
        if self.provider == "openai":
            return self._chat_once(
                client, self._get_default_model(), messages, response_format,
                timeout_seconds=timeout_seconds, max_retries=max_retries, stream=stream,
            )

        last_err: Optional[Exception] = None
        for idx, candidate in enumerate(self._DASHSCOPE_MODEL_FALLBACK_CHAIN):
            try:
                return self._chat_once(
                    client, candidate, messages, response_format,
                    timeout_seconds=timeout_seconds, max_retries=max_retries, stream=stream,
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
        messages: List[Dict[str, Any]],
        response_format: Optional[Dict[str, str]],
        *,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
        stream: bool = False,
    ) -> str:
        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
        }
        if response_format:
            kwargs["response_format"] = response_format
        if stream:
            kwargs["stream"] = True

        started_at = time.monotonic()
        chunks_received = 0
        text_chars = 0
        finish_reason = None
        http_response = None
        try:
            request_client = client
            options: Dict[str, Any] = {}
            if timeout_seconds is not None:
                options["timeout"] = timeout_seconds
            if max_retries is not None:
                options["max_retries"] = max_retries
            if options and hasattr(client, "with_options"):
                request_client = client.with_options(**options)
            from ...utils.llm_request_diagnostics import record_llm_request
            record_llm_request("comic_gen", model, messages, response_format=response_format, stream=stream)
            logger.info("LLM chat request started: model=%s", model)
            response = request_client.chat.completions.create(**kwargs)
            http_response = getattr(response, "response", None)
            logger.info("LLM chat HTTP response received: model=%s", model)
            if stream:
                parts = []
                try:
                    for chunk in response:
                        chunks_received += 1
                        if chunk.choices:
                            piece = chunk.choices[0].delta.content or ""
                            parts.append(piece)
                            text_chars += len(piece)
                            finish_reason = getattr(chunk.choices[0], "finish_reason", None) or finish_reason
                except Exception:
                    # This log precedes close(): an upstream error was raised
                    # during iteration, rather than caused by our cleanup.
                    logger.error(
                        "LLM stream iteration failed before close: model=%s elapsed=%.3f chunks=%s chars=%s finish_reason=%s",
                        model, time.monotonic() - started_at, chunks_received, text_chars, finish_reason,
                    )
                    raise
                finally:
                    response.close()
                content = "".join(parts)
            else:
                content = response.choices[0].message.content
            if not stream and response.choices:
                finish_reason = getattr(response.choices[0], "finish_reason", None)
            logger.info(
                "LLM chat response body decoded: model=%s chars=%s finish_reason=%s",
                model, len(content or ""), finish_reason,
            )
            text_chars = len(content or '')
            if finish_reason in LLM_CONTENT_REFUSAL_FINISH_REASONS or finish_reason == 'length':
                raise LLMResponseTerminationError(finish_reason)
            return content
        except Exception as e:
            provider_label = "DashScope" if self.provider != "openai" else "OpenAI"
            # Preserve the provider's diagnostic boundary.  OpenAI-compatible
            # gateways often collapse the useful upstream cause into a bare
            # ``Error code: 502`` string; response headers/body may still carry
            # a request ID and a short failure reason.  Never log the request
            # payload or credentials.
            status = getattr(e, "status_code", None)
            response = getattr(e, "response", None)
            if response is None:
                response = http_response
            if status is None and response is not None:
                status = getattr(response, "status_code", None)
            request_id = None
            headers = getattr(response, "headers", None)
            if headers:
                request_id = headers.get("x-request-id") or headers.get("request-id")
            detail = str(e)
            body = getattr(e, "body", None)
            if body and isinstance(body, (str, dict)):
                detail = f"{detail}; body={str(body)[:500]}"
            logger.error(
                "LLM provider request failed: provider=%s model=%s status=%s request_id=%s detail=%s",
                provider_label, model, status, request_id, detail[:800],
            )
            suffix = f" status={status}" if status is not None else ""
            if request_id:
                suffix += f" request_id={request_id}"
            error = e if isinstance(e, LLMResponseTerminationError) else RuntimeError(f"{provider_label} API error{suffix}: {detail}")
            error.llm_diagnostic = {
                "stream": stream, "elapsed_seconds": round(time.monotonic() - started_at, 3),
                "chunks_received": chunks_received, "text_chars": text_chars,
                "finish_reason": finish_reason, "request_id": request_id,
                "exception_type": type(e).__name__,
            }
            if error is e:
                raise
            raise error from e
