import modal

stub = modal.Stub("faster-whisper")

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
        ],
    )
    .pip_install("faster-whisper")
    .apt_install("curl")
    .run_function(download_model)
)


@stub.function(image=image, gpu="A10G")
def transcribe():
    import subprocess

    from faster_whisper import WhisperModel

    # Run on GPU with FP16
    model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")

    subprocess.run(
        "curl -o audio.mp3 -sSfLO https://upload.wikimedia.org/wikipedia/commons/5/5e/Ada_Lovelace_%28As_Told_By_U.S._Chief_Technology_Officer_Megan_Smith%29.mp3",
        shell=True,
    )
    segments, info = model.transcribe("audio.mp3", beam_size=5)

    print(
        "Detected language '%s' with probability %f"
        % (info.language, info.language_probability)
    )

    for segment in segments:
        print(
            "[%.2fs -> %.2fs] %s" % (segment.start, segment.end, segment.text)
        )
