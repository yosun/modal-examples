import tempfile
import time
from pathlib import Path

import modal

stub = modal.Stub(name="example-voice-chatbot")


transcriber_image = (
    modal.Image.debian_slim()
    .apt_install("git", "ffmpeg")
    .pip_install(
        "https://github.com/openai/whisper/archive/v20230314.tar.gz",
        "ffmpeg-python",
    )
)


def load_audio(data: bytes, sr: int = 16000):
    import ffmpeg
    import numpy as np

    try:
        fp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        fp.write(data)
        fp.close()
        # This launches a subprocess to decode audio while down-mixing and resampling as necessary.
        # Requires the ffmpeg CLI and `ffmpeg-python` package to be installed.
        out, _ = (
            ffmpeg.input(
                fp.name,
                threads=0,
                format="f32le",
                acodec="pcm_f32le",
                ac=1,
                ar="48k",
            )
            .output("-", format="s16le", acodec="pcm_s16le", ac=1, ar=sr)
            .run(
                cmd=["ffmpeg", "-nostdin"],
                capture_stdout=True,
                capture_stderr=True,
            )
        )
    except ffmpeg.Error as e:
        raise RuntimeError(f"Failed to load audio: {e.stderr.decode()}") from e

    return np.frombuffer(out, np.int16).flatten().astype(np.float32) / 32768.0


class Transcriber:
    def __enter__(self):
        import torch
        import whisper

        self.use_gpu = torch.cuda.is_available()
        device = "cuda" if self.use_gpu else "cpu"
        self.model = whisper.load_model("base.en", device=device)

    @stub.function(
        gpu="A10G",
        container_idle_timeout=300,
        image=transcriber_image,
    )
    def transcribe_segment(
        self,
        audio_data: bytes,
    ):
        t0 = time.time()
        np_array = load_audio(audio_data)
        result = self.model.transcribe(np_array, language="en", fp16=self.use_gpu)  # type: ignore
        print(f"Transcribed in {time.time() - t0:.2f}s")

        return result


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
        self.tokenizer = LlamaTokenizer.from_pretrained(
            str(cache_path / "llama-tokenizer")
        )

        model = LlamaForCausalLM.from_pretrained(
            str(cache_path / "llama"),
            load_in_8bit=True,
            torch_dtype=torch.float16,
            device_map="auto",
        )
        model = PeftModel.from_pretrained(
            model,
            str(cache_path / "peft"),
            torch_dtype=torch.float16,
        )

        # unwind broken decapoda-research config
        model.config.pad_token_id = self.tokenizer.pad_token_id = 0  # unk
        model.config.bos_token_id = 1
        model.config.eos_token_id = 2

        model.eval()
        self.model = torch.compile(model)

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


static_path = Path(__file__).with_name("frontend").resolve()


@stub.function(
    mounts=[modal.Mount.from_local_dir(static_path, remote_path="/assets")],
    container_idle_timeout=300,
)
@stub.asgi_app()
def web():
    from fastapi import FastAPI, Request
    from fastapi.staticfiles import StaticFiles

    web_app = FastAPI()
    transcriber = Transcriber()
    alpaca = AlpacaLoRAModel()

    @web_app.post("/transcribe")
    async def transcribe(request: Request):
        bytes = await request.body()
        result = transcriber.transcribe_segment.call(bytes)
        return result["text"]

    @web_app.post("/submit")
    async def submit(request: Request):
        body = await request.json()
        result = alpaca.generate.call(body.get("input", ""))
        return result

    web_app.mount("/", StaticFiles(directory="/assets", html=True))
    return web_app
