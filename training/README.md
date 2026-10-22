# training

Training a small model to fish, in Python. The game itself isn't re-implemented here: Python plays the real one from `src/game` through a small Node process, so training and the website always run the same rules.

```
bridge.ts         Node side: runs the game, talks JSON over stdin/stdout
fishing_env.py    Python side: FishingEnv with reset() and step(), Gymnasium style
smoke.py          plays a few seeds with the heuristic; scores should match npm run score
explore.ipynb     step 2: poke at the environment and write encode()
features.py       encode(), action helpers, and the heuristic's aiming (lead_for)
clone.ipynb       step 3: behavior cloning, then export the weights to src/game/hunters/
parity.py         checks the browser clone (clone.ts) and Python agree, decision for decision
train_battle.py   the clone again, for pt.4's battle bowl: src/game/hunters/battle-weights.json

record_moments.ts records stream moments from headless games, for the chat model's training set
teach.py          a local teacher (gemma3:12b in Ollama) writes lines for those moments
voice.ipynb       fine-tunes SmolLM2-135M on the teacher's lines: the chatter page's chat model
export_voice.py   that model -> ONNX for Transformers.js (4-bit for the GPU, 8-bit for the CPU)
serve_voice.py    serves an export to the dev page, to try it before uploading
record_battle_moments.ts, train_voice.py
                  the same for the battle opponent's lines (pt.4), see below
requirements.txt  everything except PyTorch
```

## Setup

From the repo root, with Python 3.12 (`py -3.12` on Windows) and the Node dependencies installed (`npm install`):

```bash
py -3.12 -m venv training\.venv
.\training\.venv\Scripts\python.exe -m pip install --upgrade pip
.\training\.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.\training\.venv\Scripts\python.exe -m pip install -r training\requirements.txt
```

In PowerShell, keep the leading `.\`: without it, `training\...` is read as the name of a PowerShell module and fails with "the module 'training' could not be loaded".

The CPU build of PyTorch is plenty: the model is a few thousand weights, and at that size moving data to a GPU costs more than the math.

## Check it works

```bash
.\training\.venv\Scripts\python.exe training\smoke.py
```

Seed 1 should come out at 44 points and 15 catches, the same as `npm run score`.

## Explore

```bash
.\training\.venv\Scripts\jupyter.exe lab training
```

Then open `explore.ipynb`.

## Train the clone

Open `clone.ipynb` the same way and run it top to bottom (about a minute). The last cell writes `src/game/hunters/clone-weights.json`, which the players page imports. Then check the TypeScript side matches:

```bash
.\training\.venv\Scripts\python.exe training\parity.py
```

It should report a largest feature difference of 0 and every choice the same. `npm run score` shows the clone next to the other hunters.

If you change `encode()`, change `encode()` in `src/game/hunters/clone.ts` the same way, retrain, and rerun the parity check.

## Train the battle model

The battle page's model is the same pick-a-fish network, retrained for two fishermen in one bowl:

```bash
.	raining.venvScriptspython.exe training	rain_battle.py
.	raining.venvScriptspython.exe trainingparity.py --battle
```

It records the heuristic in battles against every other AI from both boats (480 games, about a minute), trains on that, then runs two rounds of DAgger: the model fishes, and the heuristic labels the spots it ends up in, which are spots the heuristic never gets itself into. The right-hand boat sees the bowl mirrored, so the model always faces right. On top of the solo 40 numbers it gets 6 about the other fisherman: their hook, whether their bait is in, how fresh it is, and the score gap.

Over 200 seeds against the heuristic it scores about 26 points to the heuristic's 30 and wins about a third of the time. The solo model in the same seat scores about 24. `npm run score -- --battle` shows every AI against every other.

## Train the chat model

The chatter page's chat is a fine-tuned SmolLM2-135M. Building it takes four steps:

1. **Record moments.** `npx tsx training/record_moments.ts` plays 300 headless games with each player streaming and keeps 1,500 moments (a catch, stolen bait, a cast someone disagrees with), spread evenly over who's talking and about what. The context text comes from `src/chatter/prompt.ts`, the same function the browser uses.
2. **Have a teacher write lines.** With [Ollama](https://ollama.com) running `gemma3:12b` on a local GPU, `teach.py` writes three lines per moment in the speaker's voice, then a second pass (`--short`) writes quick reactions, and `--merge` combines them into `data/lines.jsonl`. About an hour of GPU time.
3. **Fine-tune.** Run `voice.ipynb`. It caps repeated lines, trims the quick reactions so line lengths stay mixed, holds out 150 moments, and trains for about 25 minutes a pass on the CPU. It saves `training/voice-model/`.
4. **Export and upload.** `export_voice.py` runs in its own environment, because the ONNX exporter needs older library versions than training:

```bash
py -3.12 -m venv training\.venv-export
.\training\.venv-export\Scripts\python.exe -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
.\training\.venv-export\Scripts\python.exe -m pip install transformers==4.49.0 "optimum-onnx[onnxruntime]" onnx==1.17.0 onnxruntime==1.20.1 onnxconverter-common accelerate
.\training\.venv-export\Scripts\python.exe training\export_voice.py
```

It writes `training/voice-out/<version>/`. The version is a hash of the model, so browsers can't keep serving an old one. Upload that folder to the model bucket under `voice/`, and the page picks it up from `src/chatter/voice-version.json`. To try an export before uploading, run `serve_voice.py` and open `/live/?voicehost=http://localhost:8787/` on the dev server.

The model isn't in git: it's a build output, and over GitHub's 100 MB file limit.

### The battle opponent's chat model

The AI on the battle page talks to you with a second model, built the same way from battle moments:

```bash
npx tsx training/record_battle_moments.ts
.	raining.venvScriptspython.exe training	each.py --battle
.	raining.venvScriptspython.exe training	each.py --battle --short
.	raining.venvScriptspython.exe training	each.py --battle --merge
.	raining.venvScriptspython.exe training	rain_voice.py --battle
.	raining.venv-exportScriptspython.exe trainingexport_voice.py --battle
```

The moments come from headless battles, every AI against every other, 1,400 of them spread over who's talking and about what. Moments that rarely happen between two AIs, like a draw or a close lead change, are topped up with made-up scores so the teacher has something to write for each. train_voice.py is voice.ipynb as a script. The export lands in `training/battle-voice-out/<version>/` and goes in the bucket under `battle-voice/`; `src/battle/voice-version.json` points the page at it.

**Phones aren't supported.** On an iPhone, loading the model pushed the page past 2 GB and iOS closed the tab, with both the GPU and the CPU builds. Natively the 8-bit model needs about 210 MB, so the overhead is the browser runtime's.
