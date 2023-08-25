from pathlib import Path
from typing import Iterator, Tuple

import modal

MODEL_SIZE = "large-v2"


def download_model():
    from faster_whisper import WhisperModel

    WhisperModel(MODEL_SIZE)


image = (
    modal.Image.from_dockerhub(
        "nvidia/cuda:11.7.1-cudnn8-runtime-ubuntu20.04",
        setup_dockerfile_commands=[
            "RUN apt-get update",
            "RUN apt-get install -y python3 python3-pip python-is-python3",
            "RUN echo 'debconf debconf/frontend select Noninteractive' | debconf-set-selections",
        ],
    )
    .apt_install("curl", "ffmpeg")
    .pip_install("faster-whisper", "ffmpeg-python")
    .run_function(download_model)
)

stub = modal.Stub("faster-whisper", image=image)

nfs_volume = modal.NetworkFileSystem.persisted("podcast-vol")
NFS_MOUNT_PATH = Path("/vol")

DEFAULT_AUDIO_URL = "https://api.substack.com/feed/podcast/136047711/48d981d835799b970867b03c1ec3ff2a.mp3"


@stub.function(gpu="A10G", network_file_systems={NFS_MOUNT_PATH: nfs_volume})
def transcribe(interval: Tuple[float, float], audio_filepath: Path):
    import tempfile
    import time

    import ffmpeg
    from faster_whisper import WhisperModel

    start, end = interval
    # Run on GPU with FP16
    model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")

    t0 = time.time()
    with tempfile.NamedTemporaryFile(suffix=".mp3") as f:
        (
            ffmpeg.input(str(audio_filepath))
            .filter("atrim", start=start, end=end)
            .output(f.name)
            .overwrite_output()
            .run(quiet=True)
        )

        segments, info = model.transcribe(f.name, beam_size=5)

    print(
        f"Transcribed segment {start:.2f} to {end:.2f} ({end - start:.2f}s duration) in {time.time() - t0:.2f} seconds."
    )

    # Add back offsets.
    segments = list(segments)
    for segment in segments:
        segment._replace(start=segment.start + start, end=segment.end + start)

    return segments


def split_silences(
    path: str, min_segment_length: float = 30.0, min_silence_length: float = 0.2
) -> Iterator[Tuple[float, float]]:
    """Split audio file into contiguous chunks using the ffmpeg `silencedetect` filter.
    Yields tuples (start, end) of each chunk in seconds."""

    import re

    import ffmpeg

    silence_end_re = re.compile(
        r" silence_end: (?P<end>[0-9]+(\.?[0-9]*)) \| silence_duration: (?P<dur>[0-9]+(\.?[0-9]*))"
    )

    metadata = ffmpeg.probe(path)
    duration = float(metadata["format"]["duration"])

    reader = (
        ffmpeg.input(str(path))
        .filter("silencedetect", n="-10dB", d=min_silence_length)
        .output("pipe:", format="null")
        .run_async(pipe_stderr=True)
    )

    cur_start = 0.0
    num_segments = 0

    while True:
        line = reader.stderr.readline().decode("utf-8")
        if not line:
            break
        match = silence_end_re.search(line)
        if match:
            silence_end, silence_dur = match.group("end"), match.group("dur")
            split_at = float(silence_end) - (float(silence_dur) / 2)

            if (split_at - cur_start) < min_segment_length:
                continue

            yield cur_start, split_at
            cur_start = split_at
            num_segments += 1

    # silencedetect can place the silence end *after* the end of the full audio segment.
    # Such segments definitions are negative length and invalid.
    if duration > cur_start and (duration - cur_start) > min_segment_length:
        yield cur_start, duration
        num_segments += 1
    print(f"Split {path} into {num_segments} segments")


@stub.function(network_file_systems={NFS_MOUNT_PATH: nfs_volume}, timeout=900)
def transcribe_episode(audio_url: str = DEFAULT_AUDIO_URL):
    import subprocess

    output_path = NFS_MOUNT_PATH / "audio.mp3"
    subprocess.run(f"curl -o {output_path} -sSfLO {audio_url}", shell=True)

    segment_gen = split_silences(output_path.as_posix())

    for result in transcribe.map(
        segment_gen, kwargs=dict(audio_filepath=output_path)
    ):
        for segment in result:
            print(segment.text)
