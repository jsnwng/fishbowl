r"""Fine-tune SmolLM2-135M on the teacher's lines: voice.ipynb as a script, for pt.4's opponent.

    .\training\.venv\Scripts\python.exe training\train_voice.py --battle

The same recipe as voice.ipynb: cap repeated lines, trim quick reactions so lengths stay mixed,
hold out some moments, then one pass of AdamW at 1e-4 with the loss on the answer only.
With --battle it reads training/data/battle-lines.jsonl (teach.py --battle) and saves
training/battle-voice-model/, which export_voice.py --battle turns into the browser's files.
"""

import argparse
import json
import random
import time
from collections import Counter
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

HERE = Path(__file__).resolve().parent
NAME = "HuggingFaceTB/SmolLM2-135M-Instruct"
CHATTER_SYSTEM = "You write one short chat line for a pixel-art fishing stream, in the speaker's voice."
# must match BATTLE_SYSTEM in src/battle/talk.ts
BATTLE_SYSTEM = "You write one short line a fisherman says to the human player fishing against them, in the fisherman's voice."

parser = argparse.ArgumentParser()
parser.add_argument("--battle", action="store_true", help="the battle opponent instead of the chatter page's chat")
args = parser.parse_args()
DATA = HERE / "data" / ("battle-lines.jsonl" if args.battle else "lines.jsonl")
SAVE = HERE / ("battle-voice-model" if args.battle else "voice-model")
SYSTEM = BATTLE_SYSTEM if args.battle else CHATTER_SYSTEM
SHORT_SHARE = {"opponent": 0.25} if args.battle else {"chat": 0.35, "streamer": 0.20}
HELD_OUT = 120 if args.battle else 150
BATCH = 16

random.seed(0)
torch.manual_seed(0)

# ---- the data ----
rows = [json.loads(l) for l in DATA.read_text(encoding="utf-8").splitlines() if l.strip()]
seen = Counter()
kept = []
for r in rows:  # any exact line at most 3 times per speaker and kind of moment
    key = (r["speaker"], r["slot"], r["line"].lower())
    if seen[key] < 3:
        seen[key] += 1
        kept.append(r)
trimmed = []
for role, share in SHORT_SHARE.items():  # quick reactions shouldn't drown out real sentences
    lines = [r for r in kept if r["role"] == role]
    short = [r for r in lines if len(r["line"].split()) <= 3]
    longer = [r for r in lines if len(r["line"].split()) > 3]
    n = min(len(short), round(share / (1 - share) * len(longer)))
    trimmed += longer + random.sample(short, n)
kept = trimmed
ids = sorted({r["id"] for r in kept})
random.shuffle(ids)
val_ids = set(ids[:HELD_OUT])
train = [r for r in kept if r["id"] not in val_ids]
val = [r for r in kept if r["id"] in val_ids]
print(f"{len(rows)} lines, {len(kept)} after capping and trimming: {len(train)} to train on, {len(val)} held out")

# ---- the model ----
tok = AutoTokenizer.from_pretrained(NAME)
device = "cuda" if torch.cuda.is_available() else "cpu"
model = AutoModelForCausalLM.from_pretrained(NAME, dtype=torch.float32).to(device)


def chat_text(prompt):
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
    return tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)


def encode(r):
    prompt_ids = tok(chat_text(r["prompt"]), add_special_tokens=False)["input_ids"]
    answer_ids = tok(r["line"] + tok.eos_token, add_special_tokens=False)["input_ids"]
    return prompt_ids + answer_ids, [-100] * len(prompt_ids) + answer_ids  # grade only the answer


def batches(data, shuffle):
    order = list(range(len(data)))
    if shuffle:
        random.shuffle(order)
    for s in range(0, len(order), BATCH):
        enc = [encode(data[i]) for i in order[s : s + BATCH]]
        width = max(len(x) for x, _ in enc)
        ids = torch.full((len(enc), width), tok.pad_token_id)
        labels = torch.full((len(enc), width), -100)
        mask = torch.zeros((len(enc), width), dtype=torch.long)
        for j, (x, y) in enumerate(enc):
            ids[j, : len(x)] = torch.tensor(x)
            labels[j, : len(y)] = torch.tensor(y)
            mask[j, : len(x)] = 1
        yield ids.to(device), mask.to(device), labels.to(device)


@torch.no_grad()
def val_loss():
    model.eval()
    losses = [model(input_ids=i, attention_mask=m, labels=l).loss.item() for i, m, l in batches(val, False)]
    model.train()
    return sum(losses) / len(losses)


@torch.no_grad()
def say(prompt, n=3):
    model.eval()
    inputs = tok(chat_text(prompt), add_special_tokens=False, return_tensors="pt").to(device)
    out = model.generate(**inputs, max_new_tokens=24, do_sample=True, temperature=0.8, top_p=0.9, num_return_sequences=n, pad_token_id=tok.pad_token_id)
    start = inputs["input_ids"].shape[1]
    return [tok.decode(o[start:], skip_special_tokens=True).strip() for o in out]


# ---- train: one pass ----
print(f"held-out loss before training: {val_loss():.2f}  ({device})")
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4, weight_decay=0.01)
model.train()
t0 = time.perf_counter()
total = (len(train) + BATCH - 1) // BATCH
for step, (ids_, mask, labels) in enumerate(batches(train, True), 1):
    loss = model(input_ids=ids_, attention_mask=mask, labels=labels).loss
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    optimizer.zero_grad()
    if step % 20 == 0 or step == total:
        per = (time.perf_counter() - t0) / step
        print(f"step {step}/{total}  loss {loss.item():.2f}  about {per * (total - step) / 60:.0f} min left", flush=True)
print(f"held-out loss after training: {val_loss():.2f}")
model.save_pretrained(SAVE)
tok.save_pretrained(SAVE)
print(f"saved to {SAVE}")

# ---- a look at what it says, on moments it never saw ----
by_moment = {}
for r in val:
    by_moment.setdefault(r["id"], []).append(r)
for mid in random.sample(list(by_moment), min(10, len(by_moment))):
    r = by_moment[mid][0]
    print()
    print(r["prompt"].replace("\n", " | "))
    for line in say(r["prompt"]):
        print("  model:  ", line)
    print("  teacher:", by_moment[mid][0]["line"])
