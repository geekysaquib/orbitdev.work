"""
ORBIT local AI worker — runs a small open-weight model through llama-cpp-python
entirely offline (no API key, no per-request cost). Requires:
    pip install llama-cpp-python

Spawned once by the Node agent (server.mjs) and kept warm so the model loads
only once, not per request. Talks newline-delimited JSON over stdin/stdout:

    in:  {"prompt": "...", "system": "..."}\n
         {"messages": [{"role": "user", "content": "..."}, ...], "system": "..."}\n
         ...either shape may add "stream": true
    out: {"ok": true, "text": "..."}\n            (one response per request line)
         {"ok": false, "error": "..."}\n
    or, when "stream" was set:
         {"ok": true, "delta": "..."}\n           (many, in order)
         {"ok": true, "done": true}\n             (exactly one, terminates)

`messages` carries a multi-turn conversation (Ask AI's follow-up thread) and
wins when present; `prompt` is the single-turn form the other callers still
use. Exactly one of the two is required. An error line terminates a streaming
request too, so every request ends on exactly one non-delta line.

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
# Kept deliberately low: a 1B model on CPU generates serially at ~5-7 tok/s, so
# every token is wall-clock the user waits through — 384 tokens measured at ~75s
# against a realistic prompt, 220 at ~30s. Enough for a short threaded reply, no
# more. Streaming (below) hides most of what's left by showing tokens as they land.
MAX_TOKENS = 220
# Small models keep going after they've answered — often restarting the turn or
# narrating a fake dialogue. Cutting at these reclaims seconds that would other-
# wise be spent generating text the UI throws away.
STOP = ["\nUser:", "\nAssistant:", "\nHuman:", "<|eot_id|>", "<|end_of_text|>"]


def scrub(s):
    """Drop lone surrogates, which are not encodable as UTF-8.

    Needed on both sides of the model:
      - output: MAX_TOKENS (and per-chunk streaming boundaries) can slice a
        multi-byte character in half, and llama-cpp-python's detokenizer emits a
        lone surrogate for the truncated byte(s) rather than dropping it, which
        blows up emit()'s stdout.write().
      - input: the workspace snapshot is assembled from live Zoho/Supabase text
        and truncated on the way here, so a lone surrogate can arrive in the
        prompt. JSON carries it through intact (`\\udc9d` round-trips into a
        Python str), and llama_cpp raises UnicodeEncodeError while tokenizing —
        before generation ever starts.
    """
    return s.encode("utf-8", "ignore").decode("utf-8", "ignore")


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
            {"role": m["role"], "content": scrub(str(m["content"]).strip())}
            for m in raw
            if isinstance(m, dict)
            and m.get("role") in ("user", "assistant")
            and str(m.get("content", "")).strip()
        ]
    prompt = str(req.get("prompt", "")).strip()
    return [{"role": "user", "content": scrub(prompt)}] if prompt else []


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
            messages = ([{"role": "system", "content": scrub(str(system))}] if system else []) + turns
            common = {"messages": messages, "max_tokens": MAX_TOKENS, "temperature": 0.7, "stop": STOP}
            if req.get("stream"):
                # One {"delta": ...} per chunk, then a single {"done": true} to
                # close the request — the caller stays subscribed until it lands.
                for chunk in model.create_chat_completion(stream=True, **common):
                    piece = chunk["choices"][0].get("delta", {}).get("content")
                    if piece:
                        emit({"ok": True, "delta": scrub(piece)})
                emit({"ok": True, "done": True})
            else:
                out = model.create_chat_completion(**common)
                emit({"ok": True, "text": scrub(out["choices"][0]["message"]["content"] or "")})
        except Exception as e:  # noqa: BLE001 — one bad request shouldn't kill the worker
            emit({"ok": False, "error": str(e)[:300]})


if __name__ == "__main__":
    main()
