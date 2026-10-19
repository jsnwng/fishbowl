"""The fishing game as a Python environment.

FishingEnv starts training/bridge.ts in a Node process and talks to it in JSON. The game is
the real one from src/game, the same code the website runs, so nothing here re-implements
the rules.

It follows the usual Gymnasium shape:

    env = FishingEnv()
    obs, info = env.reset(seed=1)
    while True:
        obs, reward, terminated, truncated, info = env.step(action)
        if terminated:
            break

obs is a dict (see Observation in src/game/types.ts), not a vector of numbers yet. Turning
it into numbers a network can read is your encode() in the notebook.

Actions are dicts too: cast(x, y), REEL or WAIT.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / "training" / "bridge.ts"

# The bowl, in pixels. Handy for scaling positions to roughly 0..1.
WIDTH = 320
HEIGHT = 180

Obs = dict[str, Any]
Action = dict[str, Any]

REEL: Action = {"type": "reel"}
WAIT: Action = {"type": "wait"}


def cast(x: float, y: float) -> Action:
    return {"type": "cast", "x": float(x), "y": float(y)}


class FishingEnv:
    """One game at a time, played through the bridge. Close it when done (or use `with`)."""

    def __init__(self) -> None:
        # One Node process: `--import tsx` adds TypeScript support in-process, where the tsx
        # command would launch a chain of helper processes.
        self._proc = subprocess.Popen(
            ["node", "--import", "tsx", str(BRIDGE)],
            cwd=ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def reset(self, seed: int = 1) -> tuple[Obs, dict[str, Any]]:
        """Start a run on this seed. Returns the first observation and an info dict."""
        r = self._send({"cmd": "reset", "seed": seed})
        return r["obs"], self._info(r)

    def step(self, action: Action) -> tuple[Obs | None, float, bool, bool, dict[str, Any]]:
        """Answer the current decision point. Returns (obs, reward, terminated, truncated, info).

        reward is the points scored since the last decision. When terminated is True the run is
        over and obs is None.
        """
        r = self._send({"cmd": "step", "action": action})
        return r["obs"], float(r["reward"]), bool(r["done"]), False, self._info(r)

    def close(self) -> None:
        if self._proc.poll() is None:
            try:
                self._proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
                self._proc.stdin.flush()
            except OSError:
                pass
            self._proc.wait(timeout=5)

    def __del__(self) -> None:
        # Re-running `env = FishingEnv()` in a notebook drops the old env; shut its bridge down.
        try:
            self.close()
        except Exception:
            pass

    def __enter__(self) -> FishingEnv:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @staticmethod
    def _info(r: dict[str, Any]) -> dict[str, Any]:
        # stats: catches, casts, empties, ... so far. teacher: what the heuristic would do here.
        return {"stats": r["stats"], "teacher": r["teacher"]}

    def _send(self, msg: dict[str, Any]) -> dict[str, Any]:
        assert self._proc.stdin and self._proc.stdout
        self._proc.stdin.write(json.dumps(msg) + "\n")
        self._proc.stdin.flush()
        line = self._proc.stdout.readline()
        if not line:
            raise RuntimeError("the bridge exited; run it by hand to see why: npx tsx training/bridge.ts")
        r = json.loads(line)
        if "error" in r:
            raise RuntimeError(f"bridge: {r['error']}")
        return r
