import time

import modal

from .common import stub

MODEL_NAME = "anon8231489123/vicuna-13b-GPTQ-4bit-128g"


def download_model():
    from huggingface_hub import hf_hub_download

    hf_hub_download(
        local_dir="/FastChat/models/anon8231489123_vicuna-13b-GPTQ-4bit-128g",
        repo_id=MODEL_NAME,
        filename="vicuna-13b-4bit-128g.safetensors",
    )


stub.vicuna_image = (
    modal.Image.from_dockerhub(
        "nvidia/cuda:11.7.0-devel-ubuntu20.04",
        setup_dockerfile_commands=[
            "RUN apt-get update",
            "RUN apt-get install -y python3 python3-pip python-is-python3",
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

""

if stub.is_inside(stub.vicuna_image):
    t0 = time.time()
    import os
    import warnings

    warnings.filterwarnings(
        "ignore", category=UserWarning, message="TypedStorage is deprecated"
    )

    # This version of FastChat hard-codes a relative path for the model ("./model"),
    # making this necessary :(
    os.chdir("/FastChat")
    from fastchat.conversation import SeparatorStyle, conv_templates
    from fastchat.serve.cli import generate_stream
    from fastchat.serve.load_gptq_model import load_quantized
    from transformers import AutoTokenizer


class Vicuna:
    def __enter__(self):
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

        print("Loading GPTQ quantized model...")
        model = load_quantized(MODEL_NAME)
        model.cuda()

        self.model = model
        self.tokenizer = tokenizer
        print(f"Model loaded in {time.time() - t0:.2f}s")

    @stub.function(
        image=stub.vicuna_image,
        gpu="A10G",
        is_generator=True,
        container_idle_timeout=300,
    )
    async def generate(self, input, history=[]):
        if input == "":
            return

        t0 = time.time()

        conv = conv_templates["v1"].copy()

        assert (
            len(history) % 2 == 0
        ), "History must be an even number of messages"

        for i in range(0, len(history), 2):
            conv.append_message(conv.roles[0], history[i])
            conv.append_message(conv.roles[1], history[i + 1])

        conv.append_message(conv.roles[0], input)
        conv.append_message(conv.roles[1], None)
        prompt = conv.get_prompt()

        params = {
            "model": MODEL_NAME,
            "prompt": prompt,
            "temperature": 0.7,
            "max_new_tokens": 512,
            "stop": conv.sep
            if conv.sep_style == SeparatorStyle.SINGLE
            else conv.sep2,
        }

        prev = len(prompt) + 2
        for outputs in generate_stream(
            self.tokenizer, self.model, params, "cuda"
        ):
            yield outputs[prev:].replace("##", "")
            prev = len(outputs)

        print(f"Output generated in {time.time() - t0:.2f}s")


@stub.local_entrypoint()
def main():
    model = Vicuna()
    for _ in range(10):
        for val in model.generate.call("What is the meaning of life?"):
            print(val, end="", flush=True)
