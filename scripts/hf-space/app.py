"""
Hugging Face Space — product re-staging.

Two ways in:
  * the web UI, for eyeballing a product before trusting it
  * the HTTP API (every Gradio Space exposes one), for the pipeline

The model session is built once at import and reused across requests. On the free
CPU tier the Space sleeps after inactivity; the first request after a sleep pays the
container start plus this import, so callers must use a generous timeout.
"""

import os

import gradio as gr
from PIL import Image
from rembg import new_session

import staging

# u2netp (4.6 MB) over u2net (176 MB): it loads in ~0.15 s and the free tier has no
# persistent disk, so a big model is re-fetched on every cold start. Set REMBG_MODEL
# to trade start-up time for edge quality once the Space is warm and proven.
MODEL = os.environ.get("REMBG_MODEL", "u2netp")
SESSION = new_session(MODEL)


def run(image, backdrops, size):
    """Returns (gallery, report). Gallery is what the UI shows; the API returns both."""
    if image is None:
        return [], "No image supplied."
    kinds = backdrops or staging.BACKDROPS
    px = int(size)
    out = staging.stage(image, kinds=kinds, size=(px, px), session=SESSION)

    hashes = {k: staging.dhash(im) for k, im in out.items()}
    src_h = staging.dhash(image.convert("RGB").resize((px, px)))

    lines = ["| backdrop | vs source | closest sibling |", "|---|---|---|"]
    for k, im in out.items():
        others = [(staging.hamming(hashes[k], hashes[o]), o) for o in out if o != k]
        near = min(others) if others else (0, "-")
        lines.append(f"| {k} | {staging.hamming(hashes[k], src_h)} | {near[1]} ({near[0]}) |")
    lines.append("")
    lines.append(
        "Distances are 8x8 dHash, 0-64. Higher is more different. A low "
        "'closest sibling' means those two staged images look alike to a "
        "deduplicator — swap in a more textured backdrop photo."
    )
    return [(im, k) for k, im in out.items()], "\n".join(lines)


with gr.Blocks(title="Product re-staging") as demo:
    gr.Markdown(
        "# Product re-staging\n"
        "Cuts the product out and places it on different backdrops. "
        "Nothing is generated — the product pixels are the source pixels, so it "
        "cannot come back as a different or warped item."
    )
    with gr.Row():
        with gr.Column():
            inp = gr.Image(type="pil", label="Product photo")
            picks = gr.CheckboxGroup(
                staging.BACKDROPS, value=staging.BACKDROPS, label="Backdrops"
            )
            size = gr.Radio(["800", "1000", "1200"], value="1000", label="Output size (px)")
            go = gr.Button("Stage", variant="primary")
        with gr.Column():
            gallery = gr.Gallery(label="Staged", columns=2, height=520)
            report = gr.Markdown()

    # api_name is the endpoint the pipeline calls. Renaming it breaks callers.
    go.click(run, [inp, picks, size], [gallery, report], api_name="stage")

# queue() serialises requests — the free tier is 2 vCPU, and parallel ONNX runs there
# make every caller slower rather than any caller faster.
demo.queue(max_size=20).launch()
