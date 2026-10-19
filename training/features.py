"""Turning observations and actions into numbers.

encode() is Jason's, from explore.ipynb. It's copied here so every notebook and script can
`from features import encode` and the model always sees the same 40 numbers.

If you change encode(), retrain: a model only understands the layout it was trained on.
"""

from fishing_env import HEIGHT, REEL, WAIT, WIDTH, cast

LINE_STATES = ["idle", "casting", "waiting", "nibble", "reeling"]
K = 5  # nearest fish to include
N_FEATURES = 5 + 2 + 3 + 6 * K  # 40


def encode(obs):
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
        features.append(obs["hook"]["x"] / WIDTH)
        features.append(obs["hook"]["y"] / HEIGHT)

    # freshness and the two timers (3 numbers)
    features.append(obs["freshness"])
    features.append(obs["nibbleLeft"] / 24)
    features.append(obs["ticksLeft"] / 7200)

    # the K nearest fish, measured from the hook (or the rod while the line is in), 6 numbers each
    start = obs["hook"] or obs["rod"]
    nearest = sorted(
        obs["fish"],
        key=lambda f: (f["x"] - start["x"]) ** 2 + (f["y"] - start["y"]) ** 2,
    )[:K]
    for f in nearest:
        features.append((f["x"] - start["x"]) / WIDTH)
        features.append((f["y"] - start["y"]) / HEIGHT)
        features.append(f["vx"] / 2)  # a frightened fish can hit about 2.3 px/tick
        features.append(f["vy"])
        features.append(f["points"] / 5)
        features.append(1.0 if f["scared"] else 0.0)
    for _ in range(K - len(nearest)):  # pad if fewer than K fish are swimming
        features += [0.0] * 6

    return features


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
