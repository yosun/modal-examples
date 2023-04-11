from pathlib import Path

import modal

stub = modal.Stub("example-get-started")


LOCAL_DBT_PROJECT = Path(__file__).parent / "src"
REMOTE_DBT_PROJECT = "/root/src"


src_mount = modal.Mount.from_local_dir(
    LOCAL_DBT_PROJECT, remote_path=REMOTE_DBT_PROJECT
)


@stub.function(image=modal.Image.debian_slim())  # , mounts=[src_mount])
def square(x):
    from src.model_caption import CaptionModel

    print(CaptionModel)

    print("This code is running on a remote worker!")
    return x**2


@stub.local_entrypoint
def main():
    print("the square is", square.call(42))
