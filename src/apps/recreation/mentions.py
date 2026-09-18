"""Compile editor media tokens against the actual ordered attachment list."""
import re

TOKEN = re.compile(r"@\{([a-f0-9]{32})\}")


def compile_mentions(text, images):
    labels = {image["media_id"]: image["label"] for image in images}
    unknown = False

    def replace(match):
        nonlocal unknown
        if match[1] not in labels:
            unknown = True
            return ""
        return labels[match[1]]

    # Reject manually typed provider labels and unresolved @ references.
    remainder = TOKEN.sub("", text)
    invalid = bool(re.search(r"@|\b(?:picture|video|audio)\s*\d+", remainder, re.I))
    compiled = TOKEN.sub(replace, text)
    return compiled, unknown or invalid
