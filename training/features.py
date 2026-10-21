"""Turning observations and actions into numbers.

encode() is Jason's, from explore.ipynb. It's copied here so every notebook and script can
`from features import encode` and the model always sees the same 40 numbers.

If you change encode(), retrain: a model only understands the layout it was trained on.
"""

import math

from fishing_env import HEIGHT, REEL, WAIT, WIDTH, cast

LINE_STATES = ["idle", "casting", "waiting", "nibble", "reeling"]
K = 5  # nearest fish to include
N_FEATURES = 5 + 2 + 3 + 6 * K  # 40


def encode(obs, width=WIDTH, height=HEIGHT):
    """Turn an observation dict into a fixed-length list of floats, roughly in -1..1."""
    features = []
    # the line state, one-hot (5 numbers)
    for state in LINE_STATES:
        features.append(1.0 if obs["line"] == state else 0.0)

    # the hook position, scaled (2 numbers)
    if obs["hook"] is None:
        features.append(0.0)
        features.append(0.0)
    else:
        features.append(obs["hook"]["x"] / width)
        features.append(obs["hook"]["y"] / height)

    # freshness and the two timers (3 numbers)
    features.append(obs["freshness"])
    features.append(obs["nibbleLeft"] / 24)
    features.append(obs["ticksLeft"] / 7200)

    # the K nearest fish, measured from the hook (or the rod while the line is in), 6 numbers each
    start = obs["hook"] or obs["rod"]
    nearest = nearest_fish(obs)
    for f in nearest:
        features.append((f["x"] - start["x"]) / width)
        features.append((f["y"] - start["y"]) / height)
        features.append(f["vx"] / 2)  # a frightened fish can hit about 2.3 px/tick
        features.append(f["vy"])
        features.append(f["points"] / 5)
        features.append(1.0 if f["scared"] else 0.0)
    for _ in range(K - len(nearest)):  # pad if fewer than K fish are swimming
        features += [0.0] * 6

    return features


# A battle adds the other fisherman: 6 more numbers after the solo 40.
N_BATTLE_FEATURES = N_FEATURES + 6  # 46


def encode_battle(obs):
    """encode(), scaled to the battle bowl, plus what the other fisherman is up to."""
    w, h = obs["bowl"]["width"], obs["bowl"]["height"]
    features = encode(obs, w, h)
    r = obs["rival"]
    start = obs["hook"] or obs["rod"]
    if r and r["hook"]:
        features += [(r["hook"]["x"] - start["x"]) / w, (r["hook"]["y"] - start["y"]) / h, 1.0]
    else:
        features += [0.0, 0.0, 0.0]
    features.append(1.0 if r and r["line"] in ("waiting", "nibble") else 0.0)
    features.append(r["freshness"] if r else 0.0)
    gap = (obs["score"] - r["score"]) / 20 if r else 0.0
    features.append(max(-1.0, min(1.0, gap)))
    return features


def nearest_fish(obs):
    """The K fish encode() describes, in the same order: nearest the hook, or the rod while the line is in."""
    start = obs["hook"] or obs["rod"]
    return sorted(
        obs["fish"],
        key=lambda f: (f["x"] - start["x"]) ** 2 + (f["y"] - start["y"]) ** 2,
    )[:K]


# The hands: where to drop the hook so a fish swims into it. This is the heuristic's
# leadFor() from src/game/hunters/heuristic.ts, line for line, so the network only has to
# choose *which* fish. The numbers are copied from src/game/rules.ts; if those change, change these.
WATERLINE = 26
CAST_BASE_TICKS = 20
CAST_TICKS_PER_PX = 0.25
SPLASH_RADIUS = 22
LEAD_GAP = 4
SKITTISH = [1, 1, 1.3, 0.8, 1.5]  # by species


def bowl_width(obs):
    """The bowl's width: 320 alone, 384 in a battle."""
    return obs["bowl"]["width"] if "bowl" in obs else WIDTH


def lead_for(f, obs):
    """The (x, y) to cast at so fish f swims into the hook, or None if it'll turn at the glass first."""
    dx = f["x"] - obs["rod"]["x"]
    dy = f["y"] - obs["rod"]["y"]
    cast_ticks = CAST_BASE_TICKS + math.sqrt(dx * dx + dy * dy) * CAST_TICKS_PER_PX
    direction = 1 if f["vx"] > 0 else -1
    lead = SPLASH_RADIUS * SKITTISH[f["species"]] + LEAD_GAP
    x = f["x"] + f["vx"] * cast_ticks + direction * lead
    if x < 8 or x > bowl_width(obs) - 8:
        return None
    return x, max(WATERLINE + 6, f["y"])


def target_slot(obs, action):
    """Which of nearest_fish(obs) a teacher cast was aimed at: 0..K-1, or -1 if none of them."""
    for j, f in enumerate(nearest_fish(obs)):
        p = lead_for(f, obs)
        if p and abs(p[0] - action["x"]) < 1e-6 and abs(p[1] - action["y"]) < 1e-6:
            return j
    return -1


# Actions as numbers. A network can't output a dict either, so an action is split in two:
#   its type, one of three classes, which the model picks between (a classification), and
#   for casts, where to cast, as x and y scaled to 0..1 (two numbers to predict: a regression).
ACTION_TYPES = ["wait", "reel", "cast"]


def action_to_target(action):
    """Teacher action dict -> (type index, [x, y] scaled). Position is [0, 0] unless casting."""
    kind = ACTION_TYPES.index(action["type"])
    if action["type"] == "cast":
        return kind, [action["x"] / WIDTH, action["y"] / HEIGHT]
    return kind, [0.0, 0.0]


def target_to_action(kind, pos):
    """The reverse: a type index and a scaled [x, y] back into an action dict for the game."""
    name = ACTION_TYPES[kind]
    if name == "cast":
        return cast(pos[0] * WIDTH, pos[1] * HEIGHT)
    return REEL if name == "reel" else WAIT
