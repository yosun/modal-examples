import tempfile
import time
from pathlib import Path

import modal

image = (
    modal.Image.debian_slim()
    .apt_install("git", "ffmpeg")
    .pip_install(
        "https://github.com/openai/whisper/archive/v20230314.tar.gz",
        "ffmpeg-python",
        "pytube~=12.1.2",
    )
)

stub = modal.Stub(name="example-voice-chatbot", image=image)


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


@stub.function(gpu="A10G")
def transcribe_segment(
    audio_data: bytes,
    model: str = "base.en",
):
    import torch
    import whisper

    t0 = time.time()
    use_gpu = torch.cuda.is_available()
    device = "cuda" if use_gpu else "cpu"
    model = whisper.load_model(model, device=device)
    np_array = load_audio(audio_data)
    result = model.transcribe(np_array, language="en", fp16=use_gpu)  # type: ignore
    print(f"Transcribed in {time.time() - t0:.2f}s")

    return result


static_path = Path(__file__).with_name("frontend").resolve()


@stub.function(
    mounts=[modal.Mount.from_local_dir(static_path, remote_path="/assets")],
)
@stub.asgi_app()
def web():
    from fastapi import FastAPI, Request
    from fastapi.staticfiles import StaticFiles

    web_app = FastAPI()

    @web_app.post("/transcribe")
    async def transcribe(request: Request):
        bytes = await request.body()
        result = transcribe_segment.call(bytes)
        return result["text"]

    web_app.mount("/", StaticFiles(directory="/assets", html=True))
    return web_app
