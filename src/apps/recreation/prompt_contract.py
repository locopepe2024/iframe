"""Model-specific recreation prompt planning; provider submission stays in the service layer."""
import hashlib
from scripts.check_h3_prompt import check_prompt
from ..agent_skills import catalog


def guidance_snapshot():
    packages = [p for p in catalog() if "MiniMax H3" in p.get("targets", [])]
    text = "\n\n".join(p["instructions"] for p in packages)
    if not text:
        raise ValueError("H3 skill guidance unavailable")
    return {"sha256": hashlib.sha256(text.encode()).hexdigest(),
            "packages": [p["id"] for p in packages], "instructions": text}


def compile_h3(description, instruction, *, replacement, duration, audio_policy, soundscape,
               source_video=False):
    """Compile the checked H3 recreation prompt.

    ``source_video`` is deliberately explicit.  The generic prompt helper is
    also used by offline contract tests, while the paid recreation path must
    opt into the Ref2V contract and name the registered source as ``<Video 1>``.
    """
    source = ""
    subject_picture = "<Picture 1>"
    if source_video:
        source = ("<Video 1> is the original source video. Preserve its camera movement, "
                  "timing, subject actions, lighting and scene continuity.\n")
    subject = f"<Subject 1> is the subject and scene from {subject_picture}"
    if source_video:
        subject += " tracked against <Video 1>"
    subject += "."
    retention = "<Subject 1>: partially_preserved - Preserve identity, scene, composition and camera framing; apply only the explicit changes below."
    if replacement:
        subject += "\n<Subject 2> is the replacement product from <Picture 2>."
        retention += "\n<Subject 2>: fully_preserved - Preserve the replacement packaging appearance; adapt lighting, perspective and occlusion to the scene."
    prompt = (f"subject_definitions:\n{source}{subject}\nsummary:\n[reference generation] Recreate one continuous shot.\n"
              f"retention_analysis:\n{retention}\ndetailed_description:\n[Shot 1] {description}\n{instruction}\n"
              f"Continue for {duration} seconds. No additional cuts or invented actions.\n"
              f"overall_soundscape:\n{soundscape if audio_policy == 'generated' else 'N/A'}\nnon_diegetic_music:\nN/A")
    errors = check_prompt(prompt, duration=duration, pictures=2 if replacement else 1,
                          videos=1 if source_video else 0, audios=0,
                          silent=audio_policy != "generated", cuts=[])
    return prompt, errors
