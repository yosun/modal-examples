import time
from pathlib import Path

import modal

from .common import stub

MODEL_PATH = Path("/model.bin")


vicuna_image = (
    modal.Image.micromamba()
    .apt_install("git", "gcc", "build-essential")
    .micromamba_install(
        "cudatoolkit=11.7",
        "cudnn=8.1.0",
        "cuda-nvcc=11.7",
        channels=["conda-forge", "nvidia"],
    )
    .micromamba_install("pytorch-cuda=11.7", channels=["pytorch", "nvidia"])
    .pip_install("git+https://github.com/thisserand/FastChat.git")
    # .run_commands(
    #     "git clone https://github.com/oobabooga/GPTQ-for-LLaMa.git -b cuda",
    #     "cd GPTQ-for-LLaMa && python setup_cuda.py install",
    # )
)


class VicunaModel:
    def __enter__(self):
        t0 = time.time()
        self.model = None
        print(f"Model loaded in {time.time() - t0:.2f}s")

    @stub.function(image=vicuna_image, cpu=12)
    def generate(self, input):
        t0 = time.time()
        print(f"Output generated in {time.time() - t0:.2f}s")


@stub.local_entrypoint()
def main():
    model = VicunaModel()
    for _ in range(10):
        print(model.generate.call("What is the meaning of life?"))
