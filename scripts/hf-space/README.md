---
title: Product Re-staging
emoji: 🛋️
colorFrom: gray
colorTo: indigo
sdk: gradio
sdk_version: 4.44.0
app_file: app.py
pinned: false
---

# Product re-staging

Cuts a product out of its photo and places it on a different backdrop. Free
alternative to the generative restaging in `api/worker-variants.js`.

**Not generative.** The product pixels are the source pixels, resized and moved.
It cannot return a different product, and it cannot warp or hallucinate detail —
the two failures the generative path spends a verify call defending against
(~1 in 4 rejected, each reject paid for). So there is no check step and no
per-image cost.

## Deploying

1. Create a Space: https://huggingface.co/new-space — SDK **Gradio**, hardware
   **CPU basic (free)**.
2. Push these four files to the Space repo (`app.py`, `staging.py`,
   `requirements.txt`, `README.md` — this file's YAML header is the Space config,
   so it must stay at the top):

   ```bash
   git clone https://huggingface.co/spaces/<user>/<space> hf && cd hf
   cp /path/to/scripts/hf-space/{app.py,staging.py,requirements.txt,README.md} .
   git add -A && git commit -m "product re-staging" && git push
   ```

3. Watch the build log in the Space's **Logs** tab. First build takes a few
   minutes while it installs onnxruntime.

## Backdrops

`backdrops/` is empty, so the Space falls back to procedurally drawn backdrops.
Those are flat and **hash poorly against each other** — measured 5-6 apart on an
8x8 dHash for the smooth ones, which is inside duplicate range.

Drop 4-6 real room photographs in `backdrops/`, named after the backdrop keys
(`seamless_grey.jpg`, `wall_wood.jpg`, `brick.jpg`, `concrete_beige.jpg`) and they
are used automatically. Pick photos with visible **structure** — a pendant lamp, a
window frame, floorboards running to a corner. That is what a perceptual hash
separates on; recolouring a flat wall barely moves it. Same conclusion
`api/worker-variants.js` reached about generated scenes.

## Testing it

Web UI: open the Space, upload a product photo, press **Stage**. The report table
gives each output's distance from the source and from its nearest sibling.

From code, via the API:

```python
pip install gradio_client
```

```python
from gradio_client import Client, handle_file

c = Client("<user>/<space>")                     # add hf_token= for a private Space
gallery, report = c.predict(
    image=handle_file("product.jpg"),
    backdrops=["seamless_grey", "brick"],
    size="1000",
    api_name="/stage",
)
print(report)
for item in gallery:
    print(item["image"])                          # local path to the staged file
```

Every Gradio Space also publishes an OpenAPI-ish schema at `/?view=api`, which is
the quickest way to confirm the endpoint name and argument order after a change.

## Free tier, honestly

- 2 vCPU / 16 GB, no GPU. A cut-out plus four composites measured ~2.1 s warm.
- The Space **sleeps after inactivity**. The next request pays a container start
  plus model load — allow 60 s or more of timeout on the first call, and expect
  the pipeline to need a retry path.
- Public Spaces are readable by anyone. Nothing here is secret, but set the Space
  private (and pass `hf_token`) if the product images matter.
- Fair-use limits apply. This is a batch job over a queue, not a per-request
  dependency — treat a failure as "try again later", never as "block the scrape".
