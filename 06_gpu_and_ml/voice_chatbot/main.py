import tempfile
import time
from pathlib import Path

import modal

from .common import stub
from .vicuna import VicunaModel

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


static_path = Path(__file__).with_name("frontend").resolve()


@stub.function(
    mounts=[modal.Mount.from_local_dir(static_path, remote_path="/assets")],
    container_idle_timeout=300,
)
@stub.asgi_app()
def web():
    from fastapi import FastAPI, Request
    from fastapi.responses import StreamingResponse
    from fastapi.staticfiles import StaticFiles

    web_app = FastAPI()
    transcriber = Transcriber()
    vicuna = VicunaModel()

    @web_app.post("/transcribe")
    async def transcribe(request: Request):
        bytes = await request.body()
        result = transcriber.transcribe_segment.call(bytes)
        return result["text"]

    @web_app.post("/submit")
    async def submit(request: Request):
        body = await request.json()

        return StreamingResponse(
            vicuna.generate.call(
                body.get("input", ""), body.get("history", [])
            ),
            media_type="text/event-stream",
        )

    web_app.mount("/", StaticFiles(directory="/assets", html=True))
    return web_app
