"""
ORBIT local AI worker — runs a small open-weight model through llama-cpp-python
entirely offline (no API key, no per-request cost). Requires:
    pip install llama-cpp-python

Spawned once by the Node agent (server.mjs) and kept warm so the model loads
only once, not per request. Talks newline-delimited JSON over stdin/stdout:

    in:  {"prompt": "...", "system": "..."}\n
         {"messages": [{"role": "user", "content": "..."}, ...], "system": "..."}\n
    out: {"ok": true, "text": "..."}\n            (one response per request line)
         {"ok": false, "error": "..."}\n

`messages` carries a multi-turn conversation (Ask AI's follow-up thread) and
wins when present; `prompt` is the single-turn form the other callers still
use. Exactly one of the two is required.

On startup, prints exactly one line before entering the request loop:
    {"ok": true, "status": "ready", "model": "<name>", "device": "cpu"}
or, if Python can't run llama_cpp / load the model at all:
    {"ok": false, "error": "...", "fatal": true}

The model auto-downloads (cached under ~/.cache/gpt4all — same location the
prior GPT4All-based worker used, so an existing download is reused) the first
time it's requested — that first startup can take a while depending on
connection speed.

Speed notes: this used to run on GPT4All, whose Windows build only ships CUDA
and Vulkan backends — on machines with neither a supported GPU nor a working
Vulkan driver, it silently fell back to an unoptimized path (under 1 token/s).
llama-cpp-python ships native AVX2 CPU kernels and doesn't depend on a GPU
driver at all, which is ~20x faster on that same hardware in practice.
Generation is still capped at MAX_TOKENS (short answers finish faster, and
these features — schema Q&A, triage, standups — don't need essays).
"""
import sys
import json
import os
import urllib.request

MODEL_NAME = os.environ.get("ORBIT_LOCAL_AI_MODEL", "Llama-3.2-1B-Instruct-Q4_0.gguf")
MODEL_URL = f"https://gpt4all.io/models/gguf/{MODEL_NAME}"
MODEL_DIR = os.path.join(os.path.expanduser("~"), ".cache", "gpt4all")
MODEL_PATH = os.path.join(MODEL_DIR, MODEL_NAME)
# Kept deliberately low: a 1B model on CPU generates serially, so every token is
# wall-clock the user waits through. Enough for a short threaded reply, no more.
MAX_TOKENS = 384


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def coerce_turns(req):
    """Normalize a request into a chat `messages` list, or [] if it carries nothing usable.

    Drops malformed entries rather than rejecting the whole request — a single bad
    turn shouldn't fail a conversation that is otherwise answerable.
    """
    raw = req.get("messages")
    if isinstance(raw, list) and raw:
        return [
            {"role": m["role"], "content": str(m["content"]).strip()}
            for m in raw
            if isinstance(m, dict)
            and m.get("role") in ("user", "assistant")
            and str(m.get("content", "")).strip()
        ]
    prompt = str(req.get("prompt", "")).strip()
    return [{"role": "user", "content": prompt}] if prompt else []


def ensure_model_downloaded():
    if os.path.exists(MODEL_PATH):
        return
    os.makedirs(MODEL_DIR, exist_ok=True)
    tmp_path = MODEL_PATH + ".part"
    urllib.request.urlretrieve(MODEL_URL, tmp_path)
    os.replace(tmp_path, MODEL_PATH)


def main():
    try:
        from llama_cpp import Llama
    except ImportError:
        emit({"ok": False, "error": "llama-cpp-python not installed — run: pip install llama-cpp-python", "fatal": True})
        return

    try:
        ensure_model_downloaded()
    except Exception as e:  # noqa: BLE001 — surface whatever the download step raised, verbatim, to the caller
        emit({"ok": False, "error": f"couldn't download model {MODEL_NAME}: {e}", "fatal": True})
        return

    try:
        model = Llama(model_path=MODEL_PATH, n_ctx=4096, n_threads=os.cpu_count(), verbose=False)
    except Exception as e:  # noqa: BLE001
        emit({"ok": False, "error": f"couldn't load model {MODEL_NAME}: {e}", "fatal": True})
        return

    emit({"ok": True, "status": "ready", "model": MODEL_NAME, "device": "cpu"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            emit({"ok": False, "error": "bad request"})
            continue

        system = req.get("system")
        turns = coerce_turns(req)
        if not turns:
            emit({"ok": False, "error": "prompt or messages required"})
            continue

        try:
            messages = ([{"role": "system", "content": str(system)}] if system else []) + turns
            out = model.create_chat_completion(messages=messages, max_tokens=MAX_TOKENS, temperature=0.7)
            text = out["choices"][0]["message"]["content"] or ""
            emit({"ok": True, "text": text})
        except Exception as e:  # noqa: BLE001 — one bad request shouldn't kill the worker
            emit({"ok": False, "error": str(e)[:300]})


if __name__ == "__main__":
    main()
