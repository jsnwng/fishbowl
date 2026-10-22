r"""The teacher: a big local model writes the lines the small voice will learn from.

Reads training/data/moments.jsonl (from record_moments.ts) and asks gemma3:12b, running in
Ollama on this machine, for a few lines per moment in the speaker's voice, using the
hand-written lines as examples. Writes training/data/lines.jsonl, one line per row.

    .\training\.venv\Scripts\python.exe training\teach.py            all of them
    .\training\.venv\Scripts\python.exe training\teach.py --limit 50 a pilot

The lines the voice trained on came from two passes, merged:

    teach.py --out training/data/lines_full.jsonl           three shapes per moment (keeps the longer two)
    teach.py --short --out training/data/lines_short.jsonl  quick reactions, with hints for the moment
    teach.py --merge                                        -> training/data/lines.jsonl

It keeps the GPU busy while it runs (about 2-3s per moment). Stop it any time: rerunning picks
up where it left off. At the end the model is unloaded so the GPU is free again.

--battle does the same for pt.4's opponent, from training/data/battle-moments.jsonl
(record_battle_moments.ts), into battle-lines_full.jsonl, battle-lines_short.jsonl and,
with --merge, battle-lines.jsonl:

    teach.py --battle
    teach.py --battle --short
    teach.py --battle --merge
"""

import argparse
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
MOMENTS = DATA / "moments.jsonl"
LINES = DATA / "lines.jsonl"
OLLAMA = "http://localhost:11434/api/generate"
TEACHER = "gemma3:12b"
PER_MOMENT = 3
MAX_CHARS = 60  # two lines in the speech bubble

PROMPT = """You write chat lines for a tiny pixel-art fishing game styled like a live stream. One fisherman is out on the bowl streaming; the other fishermen watch and type in chat. Each fisherman is a different kind of computer player, and talks like how it plays.

You are "{speaker}". Who you are: {persona}
{role}

What just happened:
{prompt}

How you type: {style}

Lines in your voice for this kind of moment:
{examples}

Write {n} new lines for this exact moment, in your voice, each a different shape, like real stream chat:
1. a very short reaction, one to three words
2. a short line
3. a full sentence, or a question

Make them different from the examples and from each other, and stick to what just happened. Only use numbers that appear in what just happened; don't make up stats. Each under {max} characters. No emoji, no hashtags, no quotes, no @mentions. One line each, nothing else."""

# How each voice types, for the teacher only: this is what gives short lines their own flavor.
STYLES = {
    "heuristic": 'clipped and exact, like a readout. short ones are verdicts like "suboptimal." or "+5." never says lol, never shouts.',
    "model": 'eager and polite. exclamation marks, the occasional question ("was that right?"), mentions the heuristic a lot. short ones like "nice!" or "noted!"',
    "cast and wait": 'unhurried and folksy. full calm sentences, never shouts. short ones like "patience." or "there it is."',
    "random": 'lowercase, chaotic, off topic. shouts in caps when excited ("WHAT", "NO WAY"), says lol, gg, oof, and random non sequiturs.',
}

# --short: only quick reactions, with hints that fit the moment. The first full run's short
# lines collapsed onto a few favorites ("oof" 162 times), so these are asked for on their own.
SHORT_PROMPT = """You write chat lines for a tiny pixel-art fishing game styled like a live stream. One fisherman is out on the bowl streaming; the other fishermen watch and type in chat.

You are "{speaker}". Who you are: {persona}
{role}
How you type: {style}

What just happened:
{prompt}

Write {n} different very short reactions to this, one to three words each, the way people react in stream chat. For a moment like this, people type things like: {hints}. Use those or your own, in your voice. Don't use any of these, they're worn out: {avoid}. No emoji, no hashtags, no quotes. One per line, nothing else."""

SHORT_HINTS = {
    "start": "hi, first, hello, here we go, lets go",
    "cast": "hmm, bold, ok, sure, risky",
    "cast_same": "agreed, same, good pick, yep",
    "cast_diff": "hmm, nope, bold, really?, why",
    "scared": "yikes, SPLASH, bye fish, too close",
    "catch": "nice, WHAT, lets go, clean, ez, got one",
    "stolen": "rip, nooo, so close, unlucky",
    "empty": "lol, nothing, rip, empty, again",
    "dry": "zzz, any day now, still nothing, hmm",
    "end": "gg, gg wp, GG, good run, again",
}
WORN_OUT = "oof, inefficient, nice!, oh no!, there it is, suboptimal, acceptable, noted!, optimal, steady"

ROLES = {
    "streamer": "You are the one streaming. Say it out loud to your chat, in the first person.",
    "chat": "You are watching the stream and typing in chat, reacting to the streamer.",
    "opponent": "You are in the other boat, fishing against a person in the same bowl, and you say it to them.",
}

# --battle: the same fishermen, but racing a person in one bowl and talking to them directly.
BATTLE_PROMPT = """You write what a fisherman says out loud in a tiny pixel-art fishing game. Two boats share one bowl of fish: a person in one, and you in the other, both racing to catch the most points in two minutes. Each fisherman is a different kind of computer player, and talks like how it plays.

You are "{speaker}". Who you are: {persona}
{role}

What just happened (in the score, "you" is you):
{prompt}

How you talk: {style}

Lines in your voice for this kind of moment:
{examples}

Write {n} new lines for this exact moment, in your voice, said to the person in the other boat, each a different shape:
1. a very short reaction, one to three words
2. a short line
3. a full sentence, or a question

Make them different from the examples and from each other, and stick to what just happened. Only use numbers that appear in what just happened; don't make up stats. Friendly trash talk is fine; nothing mean. Each under {max} characters. No emoji, no hashtags, no quotes, no @mentions. One line each, nothing else."""

BATTLE_SHORT_PROMPT = """You write what a fisherman says out loud in a tiny pixel-art fishing game. Two boats share one bowl of fish: a person in one, and you in the other, racing for points.

You are "{speaker}". Who you are: {persona}
{role}
How you talk: {style}

What just happened (in the score, "you" is you):
{prompt}

Write {n} different very short things you'd say to the other player about this, one to three words each. For a moment like this, people say things like: {hints}. Use those or your own, in your voice. Don't use any of these, they're worn out: {avoid}. No emoji, no hashtags, no quotes. One per line, nothing else."""

# The model's chatter-page style asked for the occasional "was that right?", and the trained voice
# overused it. Not here.
BATTLE_STYLES = STYLES | {
    "model": 'eager and polite, a little nervous to be playing a person. exclamation marks, mentions the heuristic it learned from. short ones like "nice!" or "got one!"',
}

BATTLE_SHORT_HINTS = {
    "start": "hi, good luck, lets go, ready, here we go",
    "my_catch": "got one, mine, yes, ha, too easy",
    "your_catch": "nice, hey, lucky, not bad, ok then",
    "you_spooked_me": "hey, rude, my fish, really?, come on",
    "i_spooked_you": "oops, sorry, my bad, whoops",
    "my_stolen": "rats, nooo, missed, ugh",
    "your_stolen": "ha, rip, too slow, unlucky",
    "your_empty": "nothing?, empty, ha, swing and miss",
    "lead_me": "ahead, mine now, look at that, catching up",
    "lead_you": "hmm, not for long, ok, fine",
    "final": "hurry, ten seconds, last call, go go",
    "win": "gg, good game, I win, again?",
    "lose": "gg, well played, you got me, rematch",
    "draw": "gg, a tie, even, again?",
}
BATTLE_WORN_OUT = "oof, inefficient, nice!, oh no!, there it is, suboptimal, acceptable, noted!, optimal, steady"


def ask(moment, short=False, battle=False):
    styles = BATTLE_STYLES if battle else STYLES
    if short:
        return generate(
            (BATTLE_SHORT_PROMPT if battle else SHORT_PROMPT).format(
                speaker=moment["speaker"],
                persona=moment["persona"],
                style=styles[moment["speaker"]],
                role=ROLES[moment["role"]],
                prompt=moment["prompt"],
                n=PER_MOMENT,
                hints=(BATTLE_SHORT_HINTS if battle else SHORT_HINTS)[moment["slot"]],
                avoid=BATTLE_WORN_OUT if battle else WORN_OUT,
            )
        )
    return generate((BATTLE_PROMPT if battle else PROMPT).format(
        speaker=moment["speaker"],
        persona=moment["persona"],
        style=styles[moment["speaker"]],
        role=ROLES[moment["role"]],
        prompt=moment["prompt"],
        examples="\n".join(f"- {e}" for e in moment["examples"]),
        n=PER_MOMENT,
        max=MAX_CHARS,
    ))


def generate(prompt):
    body = json.dumps(
        {
            "model": TEACHER,
            "prompt": prompt,
            "stream": False,
            "keep_alive": "2m",
            "options": {"temperature": 0.9, "num_predict": 120},
        }
    ).encode()
    req = urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=300))["response"]


def clean(text, examples):
    """The teacher's reply -> usable lines: no numbering, quotes, emoji, or anything too long."""
    out = []
    for raw in text.splitlines():
        line = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", raw).strip().strip('"').strip()
        line = line.replace("’", "'").replace("‘", "'").replace("“", "").replace("”", "")
        line = line.replace("—", " - ").replace("–", "-").replace("…", "...")
        if not (2 <= len(line) <= MAX_CHARS + 10):  # "gg" is a whole line
            continue
        if any(ord(c) > 126 for c in line) or "#" in line or "@" in line:
            continue
        if line[:1].isupper() and line[1:2].islower() and not line.startswith(("I ", "I'")):
            line = line[0].lower() + line[1:]  # chat style lowercase, but leave "WHAT" and "I" alone
        if line.lower() in (e.lower() for e in examples) or line.lower() in (o.lower() for o in out):
            continue
        out.append(line)
    return out[:PER_MOMENT]


def merge(prefix=""):
    """The full pass's longer lines plus the short pass's quick reactions -> lines.jsonl."""
    read = lambda name: [json.loads(l) for l in (DATA / name).read_text(encoding="utf-8").splitlines() if l.strip()]
    longer = [r for r in read(f"{prefix}lines_full.jsonl") if len(r["line"].split()) > 3]
    short = read(f"{prefix}lines_short.jsonl")
    rows = sorted(longer + short, key=lambda r: r["id"])
    out = DATA / f"{prefix}lines.jsonl"
    out.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    print(f"{len(longer)} longer lines + {len(short)} short reactions = {len(rows)} in {out.name}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="only the first N moments")
    parser.add_argument("--workers", type=int, default=2, help="requests in flight at once")
    parser.add_argument("--moments", type=Path, default=MOMENTS, help="moments to read")
    parser.add_argument("--out", type=Path, default=LINES, help="lines to write")
    parser.add_argument("--short", action="store_true", help="only very short reactions (see SHORT_PROMPT)")
    parser.add_argument("--merge", action="store_true", help="build lines.jsonl from the full and short passes")
    parser.add_argument("--battle", action="store_true", help="the battle opponent's lines (see the top of this file)")
    args = parser.parse_args()
    prefix = "battle-" if args.battle else ""
    if args.merge:
        return merge(prefix)
    if args.battle:
        if args.moments == MOMENTS:
            args.moments = DATA / "battle-moments.jsonl"
        if args.out == LINES:
            args.out = DATA / f"battle-lines_{'short' if args.short else 'full'}.jsonl"
    LINES_OUT = args.out

    moments = [json.loads(l) for l in args.moments.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        moments = moments[: args.limit]
    done = set()
    if LINES_OUT.exists():
        done = {json.loads(l)["id"] for l in LINES_OUT.read_text(encoding="utf-8").splitlines() if l.strip()}
    todo = [m for m in moments if m["id"] not in done]
    print(f"{len(moments)} moments, {len(done)} already done, {len(todo)} to go")

    t0 = time.perf_counter()
    written = 0
    with LINES_OUT.open("a", encoding="utf-8") as f, ThreadPoolExecutor(args.workers) as pool:
        for i, (m, reply) in enumerate(zip(todo, pool.map(lambda m: ask(m, args.short, args.battle), todo))):
            lines = clean(reply, m["examples"])
            if args.short:
                lines = [l for l in lines if len(l.split()) <= 3]
            for line in lines:
                row = {k: m[k] for k in ("id", "speaker", "role", "slot", "prompt")} | {"line": line}
                f.write(json.dumps(row) + "\n")
                written += 1
            f.flush()
            if (i + 1) % 25 == 0 or i + 1 == len(todo):
                rate = (time.perf_counter() - t0) / (i + 1)
                print(f"{i + 1}/{len(todo)} moments, {written} lines, {rate:.1f}s each, about {rate * (len(todo) - i - 1) / 60:.0f} min left", flush=True)

    # free the GPU
    body = json.dumps({"model": TEACHER, "keep_alive": 0}).encode()
    urllib.request.urlopen(urllib.request.Request(OLLAMA, body, {"Content-Type": "application/json"}))
    print("done, teacher unloaded")


if __name__ == "__main__":
    main()
