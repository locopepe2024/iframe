"""Run the B3 comparison with the user-designated 枪法_4 identity image."""

import s09_b3_trial as trial


trial.LABEL = "B3R"
trial.IDENTITY = trial.ROOT / "qiangfa4-reference-768.png"
trial.IDENTITY_SHA256 = "ba4e1a558ac1dfa21378e1e067dfe8a0cf701fa46eb8f49a4b0c8e6183e708f5"
trial.RECORD = trial.ROOT / "s09-label-ab-B3R-generation.json"
trial.OUTPUT = trial.ROOT / "s09-label-ab-B3R-replacement.mp4"


if __name__ == "__main__":
    trial.main()
