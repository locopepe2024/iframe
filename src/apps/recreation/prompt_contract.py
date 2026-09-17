"""Model-specific recreation planning; no provider submission occurs here."""
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


def compile_h3(description, instruction, *, replacement, duration, audio_policy, soundscape):
    subject = "<Subject 1> is the subject and scene from <Picture 1>."
    retention = "<Subject 1>: partially_preserved - Preserve identity, scene, composition and camera framing; apply only the explicit changes below."
    if replacement:
        subject += "\n<Subject 2> is the replacement product from <Picture 2>."
        retention += "\n<Subject 2>: fully_preserved - Preserve the replacement packaging appearance; adapt lighting, perspective and occlusion to the scene."
    prompt = (f"subject_definitions:\n{subject}\nsummary:\n[reference generation] Recreate one continuous shot.\n"
              f"retention_analysis:\n{retention}\ndetailed_description:\n[Shot 1] {description}\n{instruction}\n"
              f"Continue for {duration} seconds. No additional cuts or invented actions.\n"
              f"overall_soundscape:\n{soundscape if audio_policy == 'generated' else 'N/A'}\nnon_diegetic_music:\nN/A")
    errors = check_prompt(prompt, duration=duration, pictures=2 if replacement else 1,
                          videos=0, audios=0, silent=audio_policy != "generated", cuts=[])
    return prompt, errors
