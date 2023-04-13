import tempfile
import time

import modal

from .common import stub

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


class Whisper:
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
