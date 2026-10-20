r"""The teacher: a big local model writes the lines the small voice will learn from.

Reads training/data/moments.jsonl (from record_moments.ts) and asks gemma3:12b, running in
Ollama on this machine, for a few lines per moment in the speaker's voice, using the
hand-written lines as examples. Writes training/data/lines.jsonl, one line per row.

    .\training\.venv\Scripts\python.exe training\teach.py            all of them
    .\training\.venv\Scripts\python.exe training\teach.py --limit 50 a pilot

It keeps the GPU busy while it runs (about 2-3s per moment). Stop it any time: rerunning picks
up where it left off. At the end the model is unloaded so the GPU is free again.
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

Lines in your voice for this kind of moment:
{examples}

Write {n} new lines for this exact moment, in your voice. Make them different from the examples and from each other, and stick to what just happened. Only use numbers that appear in what just happened; don't make up stats. Each under {max} characters. No emoji, no hashtags, no quotes, no @mentions. One line each, nothing else."""

ROLES = {
    "streamer": "You are the one streaming. Say it out loud to your chat, in the first person.",
    "chat": "You are watching the stream and typing in chat, reacting to the streamer.",
}


def ask(moment):
    prompt = PROMPT.format(
        speaker=moment["speaker"],
        persona=moment["persona"],
        role=ROLES[moment["role"]],
        prompt=moment["prompt"],
        examples="\n".join(f"- {e}" for e in moment["examples"]),
        n=PER_MOMENT,
        max=MAX_CHARS,
    )
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
        if not (3 <= len(line) <= MAX_CHARS + 10):
            continue
        if any(ord(c) > 126 for c in line) or "#" in line or "@" in line:
            continue
        if not line.startswith(("I ", "I'")):
            line = line[0].lower() + line[1:]  # chat style: lowercase, like the hand-written lines
        if line.lower() in (e.lower() for e in examples) or line.lower() in (o.lower() for o in out):
            continue
        out.append(line)
    return out[:PER_MOMENT]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="only the first N moments")
    parser.add_argument("--workers", type=int, default=2, help="requests in flight at once")
    args = parser.parse_args()

    moments = [json.loads(l) for l in MOMENTS.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        moments = moments[: args.limit]
    done = set()
    if LINES.exists():
        done = {json.loads(l)["id"] for l in LINES.read_text(encoding="utf-8").splitlines() if l.strip()}
    todo = [m for m in moments if m["id"] not in done]
    print(f"{len(moments)} moments, {len(done)} already done, {len(todo)} to go")

    t0 = time.perf_counter()
    written = 0
    with LINES.open("a", encoding="utf-8") as f, ThreadPoolExecutor(args.workers) as pool:
        for i, (m, reply) in enumerate(zip(todo, pool.map(ask, todo))):
            for line in clean(reply, m["examples"]):
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
