import time
from pathlib import Path

import modal

from .common import stub

base_model = "decapoda-research/llama-7b-hf"
lora_weights = "tloen/alpaca-lora-7b"
cache_path = Path("/cache")


def download_models():
    import torch
    from peft import PeftModel
    from transformers import LlamaForCausalLM, LlamaTokenizer

    model = LlamaForCausalLM.from_pretrained(
        base_model,
    )
    model.save_pretrained(cache_path / "llama")

    model = PeftModel.from_pretrained(
        model,
        lora_weights,
    )
    model.save_pretrained(cache_path / "peft")

    tokenizer = LlamaTokenizer.from_pretrained(base_model)
    tokenizer.save_pretrained(cache_path / "llama-tokenizer")


alpaca_repo_url = "https://github.com/tloen/alpaca-lora"
alpaca_commit_hash = "fcbc45e4c0db8948743bd1227b46a796c1effcd0"

stub.alpaca_image = (
    modal.Image.micromamba()
    .micromamba_install("cudatoolkit=11.7", channels=["conda-forge", "nvidia"])
    .apt_install("git")
    # Here we place the latest repository code into /root.
    # Because /root is almost empty, but not entirely empty, `git clone` won't work,
    # so this `init` then `checkout` workaround is used.
    .run_commands(
        "cd /root && git init .",
        f"cd /root && git remote add --fetch origin {alpaca_repo_url}",
        f"cd /root && git checkout {alpaca_commit_hash}",
    )
    # The alpaca-lora repository's dependencies list is in the repository,
    # but it's currently missing a dependency and not specifying dependency versions,
    # which leads to issues: https://github.com/tloen/alpaca-lora/issues/200.
    # So we install a strictly versioned dependency list.
    .pip_install(
        "accelerate==0.18.0",
        "appdirs==1.4.4",
        "bitsandbytes==0.37.0",
        "bitsandbytes-cuda117==0.26.0.post2",
        "datasets==2.10.1",
        "fire==0.5.0",
        "gradio==3.23.0",
        "peft @ git+https://github.com/huggingface/peft.git@d8c3b6bca49e4aa6e0498b416ed9adc50cc1a5fd",
        "transformers @ git+https://github.com/huggingface/transformers.git@a92e0ad2e20ef4ce28410b5e05c5d63a5a304e65",
        "torch==2.0.0",
        "torchvision==0.15.1",
        "sentencepiece==0.1.97",
    )
    .run_function(download_models)
    .dockerfile_commands(
        [
            'SHELL ["/usr/local/bin/_dockerfile_shell.sh"]',
            'ENTRYPOINT ["/usr/local/bin/_entrypoint.sh"]',
        ]
    )
)

if stub.is_inside(stub.alpaca_image):
    import torch
    from generate import generate_prompt
    from peft import PeftModel
    from transformers import GenerationConfig, LlamaForCausalLM, LlamaTokenizer


class AlpacaLoRAModel:
    def __enter__(self):
        t0 = time.time()
        self.tokenizer = LlamaTokenizer.from_pretrained(
            str(cache_path / "llama-tokenizer")
        )
        print(f"Tokenizer loaded in {time.time() - t0:.2f}s")

        t0 = time.time()
        model = LlamaForCausalLM.from_pretrained(
            str(cache_path / "llama"),
            # load_in_8bit=True,
            torch_dtype=torch.float16,
            device_map="auto",
        )
        print(f"Llama loaded in {time.time() - t0:.2f}s")
        t0 = time.time()
        model = PeftModel.from_pretrained(
            model,
            str(cache_path / "peft"),
            torch_dtype=torch.float16,
            device_map="auto",
        )
        print(f"Peft loaded in {time.time() - t0:.2f}s")

        t0 = time.time()
        # unwind broken decapoda-research config
        model.config.pad_token_id = self.tokenizer.pad_token_id = 0  # unk
        model.config.bos_token_id = 1
        model.config.eos_token_id = 2

        model.half()  # Needed if not loading in 8 bit for some reason.
        model.eval()
        self.model = torch.compile(model)
        print(f"Remaining loaded in {time.time() - t0:.2f}s")

    @stub.function(
        gpu="A10G",
        image=stub.alpaca_image,
        container_idle_timeout=300,
    )
    def generate(
        self,
        instruction,
    ):
        t0 = time.time()
        prompt = generate_prompt(instruction)
        print("Using prompt: ", prompt)
        inputs = self.tokenizer(prompt, return_tensors="pt")
        input_ids = inputs["input_ids"].to("cuda")
        generation_config = GenerationConfig(
            temperature=0.1,
            top_p=0.75,
            top_k=40,
            num_beams=4,
        )
        with torch.no_grad():
            generation_output = self.model.generate(
                input_ids=input_ids,
                generation_config=generation_config,
                return_dict_in_generate=True,
                output_scores=True,
                max_new_tokens=128,
            )
        s = generation_output.sequences[0]
        output = self.tokenizer.decode(s)
        print(f"Output in {time.time() - t0:.2f}s")
        return output.split("### Response:")[1].strip()


@stub.local_entrypoint()
def main():
    model = AlpacaLoRAModel()
    for _ in range(10):
        print(model.generate.call("What is the meaning of life?"))
