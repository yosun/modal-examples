import time
from pathlib import Path

import modal

from .common import stub

MODEL_PATH = Path("/model.bin")


def download_model():
    import shutil
    import tempfile

    from huggingface_hub import hf_hub_download

    REPO_ID = "anon8231489123/gpt4-x-alpaca-13b-native-4bit-128g"
    FILENAME = (
        "gpt4-x-alpaca-13b-ggml-q4_1-from-gptq-4bit-128g/ggml-model-q4_1.bin"
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        hf_hub_download(
            local_dir=tmpdir,
            repo_id=REPO_ID,
            filename=FILENAME,
        )

        shutil.move(Path(tmpdir) / FILENAME, MODEL_PATH)


llama_image = (
    modal.Image.debian_slim()
    .pip_install("llama-cpp-python", "huggingface_hub")
    .run_function(download_model)
)


class LlamaCppModel:
    def __enter__(self):
        t0 = time.time()
        from llama_cpp import Llama

        self.model = Llama(model_path=str(MODEL_PATH))

        print(f"Model loaded in {time.time() - t0:.2f}s")

    @stub.function(image=llama_image, cpu=12)
    def generate(self, input):
        t0 = time.time()
        output = self.model(
            f"Question: {input} Answer: ",
            max_tokens=48,
            stop=["Q:", "\n"],
            echo=True,
        )
        print(f"Output generated in {time.time() - t0:.2f}s")

        return output


@stub.local_entrypoint()
def main():
    model = LlamaCppModel()
    for _ in range(10):
        print(model.generate.call("What is the meaning of life?"))
