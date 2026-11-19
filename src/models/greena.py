"""Public GreenA adapter names. Legacy NSFW model IDs remain supported."""

from .nsfw_new_one import GreenAImageModel, GreenAVideoModel

__all__ = ["GreenAImageModel", "GreenAVideoModel"]

# Adapter-owned model and optimizer presentation contract.
MODEL_NAMESPACE = "nsfw/"
LLM_NAMESPACE = "greena/"
SCRIPT_MODELS = ("llm-nf-all", "deepseek-v4.1-flash", "kimi-k3")
OPTIMIZER_MODELS = {"llm": "llm-nf-all", "deepseek": "deepseek-v4.1-flash"}
OPTIMIZERS = (
    {"id": "local_llm", "label": "跟随工作区剧本模型"},
    {"id": "llm", "label": "LLM · llm-nf-all"},
    {"id": "deepseek", "label": "DeepSeek · deepseek-v4.1-flash"},
)
DEFAULT_OPTIMIZER = "local_llm"
