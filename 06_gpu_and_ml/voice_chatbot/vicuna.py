import time
from pathlib import Path

import modal

from .common import stub

MODEL_PATH = Path("/model.bin")


vicuna_image = (
    modal.Image.from_dockerhub(
        "nvidia/cuda:11.7.0-devel-ubuntu20.04",
        setup_commands=[
            "apt-get update",
            "apt-get install -y python3 python3-pip python-is-python3",
        ],
    )
    .apt_install("git", "gcc", "build-essential")
    .run_commands(
        "git clone https://github.com/thisserand/FastChat.git",
        "cd FastChat && pip install -e .",
    )
    .run_commands(
        "git clone https://github.com/oobabooga/GPTQ-for-LLaMa.git -b cuda /FastChat/repositories/GPTQ-for-LLaMa",
        "cd /FastChat/repositories/GPTQ-for-LLaMa && python setup_cuda.py install",
        gpu="any",
    )
    .run_commands(
        "cd /FastChat && python download-model.py anon8231489123/vicuna-13b-GPTQ-4bit-128g"
    )
)


class VicunaModel:
    def __enter__(self):
        # python -m fastchat.serve.cli --model-name anon8231489123/vicuna-13b-GPTQ-4bit-128g --wbits 4 --groupsize 128
        t0 = time.time()
        import sys

        sys.path.insert(0, "/FastChat/repositories/GPTQ-for-LLaMa")
        self.model = None
        print(f"Model loaded in {time.time() - t0:.2f}s")

    @stub.function(image=vicuna_image, cpu=12, gpu="T4")
    def generate(self, input):
        from fastchat.serve.cli import main

        t0 = time.time()
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--model-name", type=str, default="facebook/opt-350m"
        )
        parser.add_argument("--num-gpus", type=str, default="1")
        parser.add_argument(
            "--device", type=str, choices=["cuda", "cpu"], default="cuda"
        )
        parser.add_argument("--conv-template", type=str, default="v1")
        parser.add_argument("--temperature", type=float, default=0.7)
        parser.add_argument("--max-new-tokens", type=int, default=512)
        parser.add_argument("--debug", action="store_true")
        parser.add_argument("--wbits", type=int, default=0)
        parser.add_argument("--groupsize", type=int, default=0)
        args = parser.parse_args(
            [
                "--model-name",
                "anon8231489123/vicuna-13b-GPTQ-4bit-128g",
                "--wbits",
                "4",
                "--groupsize",
                "128",
            ]
        )

        import subprocess

        subprocess.run(
            "mv /FastChat/models/anon8231489123_vicuna-13b-GPTQ-4bit-128g/vicuna-13b-4bit-128g.safetensors /FastChat/models/anon8231489123_vicuna-13b-GPTQ-4bit-128g/vicuna-13b-GPTQ-4bit-128g.safetensors",
            shell=True,
        )

        main(args)
        print(f"Output generated in {time.time() - t0:.2f}s")


@stub.local_entrypoint()
def main():
    model = VicunaModel()
    for _ in range(10):
        print(model.generate.call("What is the meaning of life?"))
