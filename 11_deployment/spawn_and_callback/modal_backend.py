import dataclasses
import random
import time
from typing import Optional

import modal

from . import config

image = modal.Image.debian_slim().pip_install("httpx")
stub = modal.Stub(name=config.modal_app_name, image=image)


@dataclasses.dataclass(frozen=True)
class Prediction:
    label: str
    score: float


@dataclasses.dataclass(frozen=True)
class PredictionResult:
    result_id: str
    predictions: list[Prediction]
    error: Optional[str] = None


def simulate_prediction(prompt: str) -> list[Prediction]:
    # Simulate slow prediction creation
    time.sleep(5)
    # Create some dummy predictions
    predictions = []
    for i in range(4):
        predictions.append(
            Prediction(
                label="dummy",
                score=(i / 10),
            )
        )
    # Simulate possibility of error.
    if random.random() > 0.8:
        raise RuntimeError("Deliberately raising a runtime exception to demo error-handling.")
    return predictions


# The notifying is retried to handle network unreliability, so the callback endpoint should
# be idempotent (ie. Can be safely called more than once for the same prediction result).
@stub.function(retries=3)
def notify_completion(callback_url: str, prediction_result: PredictionResult) -> None:
    import httpx

    print(f"Sending completion response back to '{callback_url}' callback.")
    r = httpx.post(callback_url, json=dataclasses.asdict(prediction_result))
    r.raise_for_status()  # if not 2XX, throw exception


# Simulate the creation of an ML model prediction, that is processed asynchronously
# using `.spawn()` and communicates its result back to a Flask webserver client using a callback
# webhook path on the server.
@stub.function
def predict(request_id: str, prompt: str, completion_callback_url: str) -> str:
    try:
        predictions = simulate_prediction(prompt)
        error = None
    except Exception as exc:
        predictions = []
        error = str(exc)

    result = PredictionResult(
        result_id=request_id,
        predictions=predictions,
        error=error,
    )
    notify_completion.spawn(completion_callback_url, result)


# `modal deploy` this app to ensure lookups made by the Flask web server succeed.
