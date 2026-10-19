# training

Training a small model to fish, in Python. The game itself isn't re-implemented here: Python plays the real one from `src/game` through a small Node process, so training and the website always run the same rules.

```
bridge.ts         Node side: runs the game, talks JSON over stdin/stdout
fishing_env.py    Python side: FishingEnv with reset() and step(), Gymnasium style
smoke.py          plays a few seeds with the heuristic; scores should match npm run score
explore.ipynb     step 2: poke at the environment and write encode()
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
