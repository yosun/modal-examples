import modal

stub = modal.Stub("example-get-started")

vol = modal.SharedVolume().persist("my-foo-vol")


@stub.function(cloud="gcp", shared_volumes={"/vol": vol})
def square(x):
    print("This code is running on a remote worker!")
    return x**2


@stub.local_entrypoint()
def main():
    print("the square is", square.call(42))
