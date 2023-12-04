import time

import torch
from diffusers import DiffusionPipeline

load_options = dict(
    torch_dtype=torch.float16,
    use_safetensors=True,
    variant="fp16",
)

base = DiffusionPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0", **load_options
).to("cuda:0")

base.set_progress_bar_config(leave=False)

refiner = DiffusionPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-refiner-1.0",
    text_encoder_2=base.text_encoder_2,
    vae=base.vae,
    **load_options,
).to("cuda:0")

refiner.set_progress_bar_config(leave=False)

prompt = "a potato that looks like a unicorn"
negative_prompt = "disfigured, ugly, deformed"
n_steps = 24
high_noise_frac = 0.8

times = []

for i in range(10):
    t0 = time.time()
    image = base(
        prompt=prompt,
        negative_prompt=negative_prompt,
        num_inference_steps=n_steps,
        denoising_end=high_noise_frac,
        output_type="latent",
    ).images
    image = refiner(
        prompt=prompt,
        negative_prompt=negative_prompt,
        num_inference_steps=n_steps,
        denoising_start=high_noise_frac,
        image=image,
    ).images[0]
    t = time.time() - t0

    print(f"[{i}] {t:.2f}s")
    times.append(t)

print(f"[avg] {sum(times) / len(times):.2f}s")
