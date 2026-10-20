r"""Trained chat model -> the files Transformers.js runs in the browser.

    .\training\.venv-export\Scripts\python.exe training\export_voice.py [model dir]

Default model dir: training/voice-model (what voice.ipynb saves). Writes public/live/voice/<version>/:
config.json, the tokenizer, and onnx/model_q4f16.onnx, about 118 MB. The version is a hash of the
model file, and src/live/voice-version.json tells the page which one to load. Browsers cache the
model by its URL, so a new model needs a new one.

It runs in its own environment, training/.venv-export, pinned to the versions the ONNX
exporter supports (transformers 4.49, torch 2.5, optimum-onnx). Training uses transformers 5,
which saves the model's config in a newer shape, so step 1 rewrites it the old way.

Steps:
1. a copy of the model with a transformers-4 config
2. export to ONNX with a KV cache (so each new token doesn't redo the whole prompt)
3. float32 -> float16 for everything, then 4-bit weights for the big matrix multiplies (q4f16)
4. a check: the shrunk model and the original pick the same words for a few prompts
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort

HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "voice-model"
WORK = HERE / "voice-export"
VOICES = HERE.parent / "public" / "live" / "voice"
OUT = VOICES / "next"
BASE = "HuggingFaceTB/SmolLM2-135M-Instruct"  # the tokenizer is unchanged by fine-tuning
SYSTEM = "You write one short chat line for a pixel-art fishing stream, in the speaker's voice."  # same as voice.ipynb


def step(msg):
    print(f"\n== {msg}", flush=True)


# 1. transformers-4 copy
step("copying the model with a transformers-4 config")
shutil.rmtree(WORK, ignore_errors=True)
(WORK / "v4").mkdir(parents=True)
cfg = json.loads((SRC / "config.json").read_text())
rope = cfg.pop("rope_parameters", None) or {}
cfg["rope_theta"] = rope.get("rope_theta", cfg.get("rope_theta", 100000))
cfg["rope_scaling"] = None
cfg["torch_dtype"] = cfg.pop("dtype", "float32")
(WORK / "v4" / "config.json").write_text(json.dumps(cfg, indent=2))
for f in ("model.safetensors", "generation_config.json"):
    shutil.copy(SRC / f, WORK / "v4" / f)

# 2. ONNX with a KV cache
step("exporting to ONNX")
cli = Path(sys.executable).parent / "optimum-cli"
subprocess.run([str(cli), "export", "onnx", "--model", str(WORK / "v4"), "--task", "text-generation-with-past", str(WORK / "fp32")], check=True)
fp32 = WORK / "fp32" / "model.onnx"

# 3. q4f16
step("float16, then 4-bit matrix weights")
from onnxconverter_common import float16
from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer

fp32_model = onnx.load(str(fp32))
# Layer norms stay float32. They square the activations, which overflows float16's range on the
# GPU (the CPU happens to compute it wider, so it only shows up in the browser, as garbage text).
norms = [n.name for n in fp32_model.graph.node if "layernorm/" in n.name or "/norm/" in n.name]
# The converter doesn't touch Cast nodes, so the exporter's "cast to float32" steps outside the
# layer norms (in the rotary embedding, for one) are pointed at float16 by hand.
for node in fp32_model.graph.node:
    if node.op_type == "Cast" and node.name not in norms:
        for a in node.attribute:
            if a.name == "to" and a.i == onnx.TensorProto.FLOAT:
                a.i = onnx.TensorProto.FLOAT16
model = float16.convert_float_to_float16(fp32_model, keep_io_types=False, disable_shape_infer=False, node_block_list=norms, check_fp16_ready=False)
quant = MatMul4BitsQuantizer(model, block_size=32, is_symmetric=True)
quant.process()
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "onnx").mkdir(exist_ok=True)
q4f16 = OUT / "onnx" / "model_q4f16.onnx"
onnx.save(quant.model.model, str(q4f16))
print(f"{q4f16.stat().st_size / 1e6:.0f} MB")

# config, generation config and tokenizer next to it, the layout Transformers.js loads
from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained(BASE)
tok.save_pretrained(OUT)
cfg["transformers.js_config"] = {"kv_cache_dtype": {"q4f16": "float16"}}
(OUT / "config.json").write_text(json.dumps(cfg, indent=2))
shutil.copy(SRC / "generation_config.json", OUT / "generation_config.json")

# 4. same words?
step("checking the shrunk model against the original")
n_layers, n_kv, head = cfg["num_hidden_layers"], cfg["num_key_value_heads"], cfg["head_dim"]


def greedy(path, dtype, prompt, steps=16):
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    text = tok.apply_chat_template([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}], add_generation_prompt=True, tokenize=False)
    ids = tok(text, add_special_tokens=False)["input_ids"]
    past = {f"past_key_values.{i}.{kv}": np.zeros((1, n_kv, 0, head), dtype) for i in range(n_layers) for kv in ("key", "value")}
    seq, out = list(ids), []
    feed_ids = ids
    for _ in range(steps):
        feed = {
            "input_ids": np.array([feed_ids], np.int64),
            "attention_mask": np.ones((1, len(seq)), np.int64),
            "position_ids": np.arange(len(seq) - len(feed_ids), len(seq), dtype=np.int64)[None],
            **past,
        }
        res = sess.run(None, feed)
        names = [o.name for o in sess.get_outputs()]
        logits = res[0][0, -1]
        nxt = int(np.argmax(logits))
        if nxt == tok.eos_token_id:
            break
        out.append(nxt)
        seq.append(nxt)
        feed_ids = [nxt]
        past = {n.replace("present", "past_key_values"): r for n, r in zip(names[1:], res[1:])}
    return tok.decode(out)


probes = [
    "speaker: random (chat)\nstreamer: heuristic\nmoment: heuristic caught a 5-pt blue tang\nrun: 12 pts, 5 caught, 1:10 left",
    "speaker: cast and wait (streaming)\nmoment: 40s without a catch\nrun: 3 pts, 2 caught, 0:50 left",
    "speaker: heuristic (chat)\nstreamer: model\nmoment: model reeled in nothing\nrun: 8 pts, 4 caught, 1:30 left",
]
same = 0
for p in probes:
    a, b = greedy(fp32, np.float32, p), greedy(q4f16, np.float16, p)
    same += a == b
    print(f"  original: {a!r}\n  shrunk:   {b!r}")
print(f"{same} of {len(probes)} identical (small differences are normal at 4 bits; the voice should match)")
shutil.rmtree(WORK, ignore_errors=True)

# name the folder after the model, drop older ones, and point the page at it
import hashlib

version = hashlib.sha256(q4f16.read_bytes()).hexdigest()[:10]
for old in VOICES.iterdir():
    if old.name != "next":
        shutil.rmtree(old) if old.is_dir() else old.unlink()
shutil.copytree(OUT, VOICES / version)  # copy, not rename: a running dev server holds the folder open on Windows
shutil.rmtree(OUT, ignore_errors=True)
mb = round((VOICES / version / "onnx" / "model_q4f16.onnx").stat().st_size / 1e6)
(HERE.parent / "src" / "live" / "voice-version.json").write_text(json.dumps({"version": version, "mb": mb}) + "\n")
print(f"\nwrote {VOICES / version}")
