r"""Check that the browser clone and the notebook clone are the same player.

Plays a few games in Python with the exported weights (src/game/hunters/clone-weights.json),
saves every observation with Python's features and choice, then has parity.ts replay them
through the TypeScript encode() and CloneHunter and report any difference.

    .\training\.venv\Scripts\python.exe training\parity.py      (from the repo root)
"""

import json
import subprocess
from pathlib import Path

import numpy as np

from features import REEL, WAIT, cast, encode, lead_for, nearest_fish
from fishing_env import FishingEnv

ROOT = Path(__file__).resolve().parent.parent
WEIGHTS = json.loads((ROOT / "src/game/hunters/clone-weights.json").read_text())
LAYERS = [(np.array(l["w"]), np.array(l["b"])) for l in WEIGHTS["layers"]]
OUT = Path(__file__).resolve().parent / "data/parity.json"


def forward(x):
    x = np.array(x)
    for i, (w, b) in enumerate(LAYERS):
        x = w @ x + b
        if i < len(LAYERS) - 1:
            x = np.maximum(x, 0)
    return x


def policy(obs):
    out = forward(encode(obs))
    kind = int(np.argmax(out[:3]))
    if kind == 0:
        return WAIT
    if kind == 1:
        return REEL
    fish = nearest_fish(obs)
    for j in np.argsort(-out[3:], kind="stable"):
        if j < len(fish) and not fish[j]["scared"]:
            spot = lead_for(fish[j], obs)
            if spot:
                return cast(*spot)
    return WAIT


steps = []
catches = []
with FishingEnv() as env:
    for seed in range(1, 21):
        obs, info = env.reset(seed=seed)
        done = False
        while not done:
            action = policy(obs)
            if seed <= 3:  # a few full games is plenty for the per-decision check
                steps.append({"obs": obs, "features": encode(obs), "action": action})
            obs, reward, done, _, info = env.step(action)
        catches.append(info["stats"]["catches"])

OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(steps))
print(f"python, exported weights: {sum(catches) / len(catches):.1f} catches per game on seeds 1-20")
print(f"checking {len(steps)} decisions against TypeScript...")
subprocess.run(["node", "--import", "tsx", "training/parity.ts", str(OUT)], cwd=ROOT, check=True)
