r"""Train the battle model: the pick-a-fish clone from clone.ipynb, for two fishermen in one bowl.

The same recipe as clone.ipynb's pocket 6, with three changes:
  - the teacher is the heuristic in battles, against every other AI, from both boats
    (the right-hand boat sees the bowl mirrored, so the model always faces right)
  - encode_battle() adds 6 numbers about the other fisherman: their hook, whether their
    bait is in the water, how fresh it is, and the score gap
  - the network is the same size; only its first layer gets the 6 extra inputs

It writes src/game/hunters/battle-weights.json, which src/game/hunters/battle.ts runs.

    .\training\.venv\Scripts\python.exe training\train_battle.py      (from the repo root)
"""

import json
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from features import ACTION_TYPES, K, N_BATTLE_FEATURES, REEL, WAIT, cast, encode_battle, lead_for, nearest_fish, target_slot
from fishing_env import FishingEnv

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(__file__).resolve().parent / "data/battle-teacher.npz"
OUT = ROOT / "src/game/hunters/battle-weights.json"

OPPONENTS = ["heuristic", "model", "cast and wait", "random"]
GAMES = 60  # per opponent and boat: 480 games in all
VAL_FROM = 50  # games 50..59 of each pairing are held out


# ---- 1. record the teacher in battles ----
def record(path, play=None, seed=5000):
    """Battles against every opponent from both boats, labeled with what the teacher would do.

    With `play`, that policy does the fishing and the teacher only labels the spots it gets
    into (DAgger): a copy goes wrong in places the teacher never visits, so this shows it those.
    The seeds stay away from the ones anything is scored on.
    """
    X, y_type, slot, val = [], [], [], []
    t0 = time.perf_counter()
    with FishingEnv() as env:
        for opponent in OPPONENTS:
            for seat in (0, 1):
                for g in range(GAMES):
                    obs, info = env.reset(seed=seed, battle={"seat": seat, "opponent": opponent})
                    seed += 1
                    done = False
                    while not done:
                        teacher = info["teacher"]
                        X.append(encode_battle(obs))
                        y_type.append(ACTION_TYPES.index(teacher["type"]))
                        slot.append(target_slot(obs, teacher) if teacher["type"] == "cast" else -1)
                        val.append(g >= VAL_FROM)
                        obs, reward, done, _, info = env.step(play(obs) if play else teacher)
                print(f"  vs {opponent:13s} boat {seat}: {len(X)} decisions so far, {time.perf_counter() - t0:.0f}s")
    np.savez(path, X=np.array(X, dtype=np.float32), y_type=np.array(y_type), slot=np.array(slot), val=np.array(val))


# ---- 2. train: wait/reel/cast, and which of the 5 nearest fish ----
def train(paths):
    sets = [np.load(p) for p in paths]
    X, yt, s, val = (torch.from_numpy(np.concatenate([d[k] for d in sets])) for k in ("X", "y_type", "slot", "val"))
    tr = ~val
    print(f"{len(X)} decisions: {int(tr.sum())} to learn from, {int(val.sum())} held out")
    casts = yt == 2
    print(f"casts aimed at one of the {K} nearest fish: {(s[casts] >= 0).float().mean().item():.1%}")

    torch.manual_seed(0)  # fixed starting knobs, so rerunning gives the same weights
    model = nn.Sequential(
        nn.Linear(N_BATTLE_FEATURES, 64), nn.ReLU(),
        nn.Linear(64, 64), nn.ReLU(),
        nn.Linear(64, 3 + K),
    )
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    EPOCHS = 30
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)  # big steps first, small ones to settle
    ce = nn.CrossEntropyLoss()

    def loss_of(Xb, ytb, sb):
        out = model(Xb)
        loss = ce(out[:, :3], ytb)
        labeled = sb >= 0
        if labeled.any():
            loss = loss + ce(out[:, 3:][labeled], sb[labeled])
        return loss

    Xt, ytt, st = X[tr], yt[tr], s[tr]
    for epoch in range(EPOCHS):
        perm = torch.randperm(len(Xt))
        for i in range(0, len(Xt), 256):
            idx = perm[i : i + 256]
            loss = loss_of(Xt[idx], ytt[idx], st[idx])
            loss.backward()
            opt.step()
            opt.zero_grad()
        sched.step()
        with torch.no_grad():
            print(f"epoch {epoch:2d}   train loss {loss_of(Xt, ytt, st).item():.3f}   held out {loss_of(X[val], yt[val], s[val]).item():.3f}")

    with torch.no_grad():
        out = model(X[val])
        kind_ok = (out[:, :3].argmax(1) == yt[val]).float().mean().item()
        labeled = s[val] >= 0
        fish_ok = (out[:, 3:][labeled].argmax(1) == s[val][labeled]).float().mean().item()
    print(f"held out: right action {kind_ok:.1%}, right fish {fish_ok:.1%} of casts")
    return model


# ---- 3. play it, the way battle.ts will ----
def policy(model):
    def play(obs):
        with torch.no_grad():
            out = model(torch.tensor([encode_battle(obs)]))[0]
        kind = out[:3].argmax().item()
        if kind == 0:
            return WAIT
        if kind == 1:
            return REEL
        fish = nearest_fish(obs)
        for j in out[3:].argsort(descending=True).tolist():
            if j < len(fish) and not fish[j]["scared"]:
                spot = lead_for(fish[j], obs)
                if spot:
                    return cast(*spot)
        return WAIT

    return play


def check(model, seeds=range(1, 11)):
    play = policy(model)
    with FishingEnv() as env:
        for opponent in ("heuristic", "random"):
            mine, theirs, wins = [], [], 0
            for seat in (0, 1):
                for seed in seeds:
                    obs, info = env.reset(seed=seed, battle={"seat": seat, "opponent": opponent})
                    done = False
                    while not done:
                        obs, reward, done, _, info = env.step(play(obs))
                    mine.append(info["stats"]["score"])
            print(f"  vs {opponent:9s}: {np.mean(mine):.1f} points a game")


def export(model):
    layers = [m for m in model if isinstance(m, nn.Linear)]
    OUT.write_text(
        json.dumps(
            {
                "about": "pick-a-fish clone for the battle bowl, trained in training/train_battle.py. layers run in order, ReLU between them.",
                "features": N_BATTLE_FEATURES,
                "K": K,
                "layers": [
                    {"w": [[float(f"{v:.6g}") for v in row] for row in l.weight.tolist()], "b": [float(f"{v:.6g}") for v in l.bias.tolist()]}
                    for l in layers
                ],
            },
            separators=(",", ":"),
        )
    )
    print(f"wrote {OUT}: {sum(p.numel() for p in model.parameters())} numbers, {OUT.stat().st_size / 1024:.0f} KB")


DAGGER_ROUNDS = 2

if __name__ == "__main__":
    if not DATA.exists():
        print("recording the heuristic in battles...")
        record(DATA)
    paths = [DATA]
    model = train(paths)
    for r in range(1, DAGGER_ROUNDS + 1):
        print(f"DAgger round {r}: the model fishes, the heuristic labels where it ends up...")
        path = DATA.with_name(f"battle-dagger{r}.npz")
        record(path, play=policy(model), seed=5000 + 1000 * r)
        paths.append(path)
        model = train(paths)
    print("playing it (10 seeds, both boats):")
    check(model)
    export(model)
