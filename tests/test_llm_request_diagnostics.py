import json
import stat
import sys
from types import SimpleNamespace

from src.apps import agent_api
from src.apps.comic_gen.llm_adapter import LLMAdapter
from src.utils.llm_request_diagnostics import record_llm_request


def test_debug_logging_is_off_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("IFRAME_LLM_REQUEST_DEBUG", raising=False)
    monkeypatch.setenv("LUMENX_OUTPUT_DIR", str(tmp_path))

    record_llm_request("agent", "test-model", [{"role": "user", "content": "blue robe"}])

    assert not (tmp_path / "diagnostics").exists()


def test_debug_logging_keeps_text_and_redacts_media(tmp_path, monkeypatch):
    monkeypatch.setenv("IFRAME_LLM_REQUEST_DEBUG", "1")
    monkeypatch.setenv("LUMENX_OUTPUT_DIR", str(tmp_path))
    messages = [
        {"role": "system", "content": "Design a character"},
        {"role": "user", "content": [
            {"type": "text", "text": "蓝色布料，参考 https://example.test/image?token=secret"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,abcdef"}},
            {"type": "input_audio", "input_audio": {"data": "raw-audio-bytes", "format": "mp3"}},
        ]},
    ]

    record_llm_request("agent", "test-model", messages, stream=True)

    path = tmp_path / "diagnostics" / "llm-requests.jsonl"
    record = json.loads(path.read_text())
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert record["model"] == "test-model"
    assert record["messages"][1]["image_count"] == 1
    assert "蓝色布料" in record["messages"][1]["content"][0]["text"]
    assert "secret" not in path.read_text()
    assert "abcdef" not in path.read_text()
    assert "raw-audio-bytes" not in path.read_text()


def test_agent_complete_records_exact_text_sent_to_sdk(tmp_path, monkeypatch):
    sent = {}

    class Stream:
        def __iter__(self):
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="ok"))])

        def close(self):
            pass

    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def create(self, **kwargs):
            sent.update(kwargs)
            return Stream()

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setattr(agent_api, "get_user_config_store", lambda: SimpleNamespace(
        get_runtime_uniart=lambda ctx: {"api_key": "private-key", "base_url": "https://example.test/v1"},
    ))
    monkeypatch.setenv("IFRAME_LLM_REQUEST_DEBUG", "1")
    monkeypatch.setenv("LUMENX_OUTPUT_DIR", str(tmp_path))
    messages = [{"role": "user", "content": "宋代服装样式，蓝色布料"}]

    assert agent_api.complete(SimpleNamespace(), "test-model", messages) == "ok"

    record = json.loads((tmp_path / "diagnostics" / "llm-requests.jsonl").read_text())
    assert record["messages"][0]["content"] == sent["messages"][0]["content"]
    assert record["model"] == sent["model"]
    assert "private-key" not in json.dumps(record)


def test_adapter_records_exact_text_sent_to_sdk(tmp_path, monkeypatch):
    sent = {}

    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            sent.update(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=Client))
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "private-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("IFRAME_LLM_REQUEST_DEBUG", "1")
    monkeypatch.setenv("LUMENX_OUTPUT_DIR", str(tmp_path))
    messages = [{"role": "user", "content": "粮铺门前的分镜"}]

    assert LLMAdapter().chat(messages, model="test-model") == "ok"

    record = json.loads((tmp_path / "diagnostics" / "llm-requests.jsonl").read_text())
    assert record["messages"][0]["content"] == sent["messages"][0]["content"]
    assert record["model"] == sent["model"]


def test_log_write_failure_does_not_block_request(tmp_path, monkeypatch):
    monkeypatch.setenv("IFRAME_LLM_REQUEST_DEBUG", "1")
    monkeypatch.setenv("LUMENX_OUTPUT_DIR", str(tmp_path / "not-a-directory"))
    (tmp_path / "not-a-directory").write_text("file")

    record_llm_request("agent", "test-model", [{"role": "user", "content": "a prompt"}])
