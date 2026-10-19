"""Check the bridge end to end: play a few seeds with the heuristic's own suggestions.

The scores should match `npm run score` exactly (seed 1: 44 points, 15 catches), because
it's the same game, played the same way.

    .\\training\\.venv\\Scripts\\python.exe training\\smoke.py
"""

import time

from fishing_env import FishingEnv

with FishingEnv() as env:
    for seed in (1, 2, 3):
        t0 = time.perf_counter()
        obs, info = env.reset(seed=seed)
        total, decisions, done = 0.0, 0, False
        while not done:
            obs, reward, done, _, info = env.step(info["teacher"])
            total += reward
            decisions += 1
        stats = info["stats"]
        ms = (time.perf_counter() - t0) * 1000
        print(f"seed {seed}: {stats['score']} pts, {stats['catches']} catches, reward sum {total:.0f}, {decisions} decisions, {ms:.0f} ms")
