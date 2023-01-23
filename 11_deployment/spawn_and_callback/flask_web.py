# # Using Modal as a Flask web server's prediction backend
#
# This example shows how integrate Modal Functions into an existing Flask
# web server backend. The web server accepts predictions requests and asynchronously
# processes them using Function spawning and a webhook callback endpoint.

import os
from uuid import uuid4
from urllib.parse import urlparse

import modal
from flask import Flask, jsonify, request

import config

# Fetch the web server's public-internet accessible URL, eg. https://bore.pub:<PORT>.
# request.base_url will not work if it points at localhost, because localhost:PORT is not an accessible
# webhook callback URL for the Modal backend.
#
# This callback URL will be passed to the spawned Modal prediction function, to receive POST data when predictions
# are completed.
WEB_BASE = os.environ.get("WEB_BASE")
if not WEB_BASE:
    raise RuntimeError("Must provide 'WEB_BASE' env var with public-internet accessible URL for server.")

CALLBACK_URL = f"{WEB_BASE}/callback"
try:
    urlparse(CALLBACK_URL)
    print(f"Demo server prediction callback URL is {CALLBACK_URL}")
except ValueError:
    raise RuntimeError(f"{CALLBACK_URL} is not a valid URL. Please check the WEB_BASE var's value.")

# Maintain a view on pending and completed predictions.
pending_predictions: set[str] = set()
completed_predictions: dict[str, dict] = {}

app = Flask(__name__)


# Root path is used to display the in-memory state of the Flask web server.
@app.route("/")
def index():
    return {
        "pending": list(pending_predictions),
        "completed": completed_predictions,
    }


# The callback endpoint recieves data back from the Modal backend and updates
# the in-memory state of the web server.
@app.route("/callback", methods=["POST"])
def prediction_callback():
    data = request.json
    result_id = data["result_id"]
    pending_predictions.remove(result_id)
    completed_predictions[result_id] = data  # Idempotent
    return jsonify(success=True)


# Hitting this endpoint will trigger a prediction to be sent for processing in Modal.
# This just sends a dummy prompt, but in practice this asynchronous predicting could be
# generating audio, images, or text.
@app.route("/predict")
def predict():
    prediction_fn_name = "predict"
    predict_fn = modal.lookup(app_name=config.modal_app_name, tag=prediction_fn_name)
    request_id = str(uuid4())
    predict_fn.spawn(
        request_id=request_id,
        prompt="I am a dummy text prompt :)",
        completion_callback_url=CALLBACK_URL,
    )
    pending_predictions.add(request_id)
    return f"Done! {request_id=}"


# ## Running demo
#
# To run this demo we need to expose the Flask web server over the internet and deploy the Modal
# backend. The Modal backend can be deployed with:
#
# `modal deploy spawn_and_callback.modal_backend`
#
# We won't deploy the Flask web server, but will expose it to the public internet with github.com/ekzhang/bore.
# In a terminal window run:
#
# ```
# $ bore local 5000 --to bore.pub
# 2023-01-22T22:14:59.768275Z  INFO bore_cli::client: connected to server remote_port=46087
# 2023-01-22T22:14:59.768291Z  INFO bore_cli::client: listening at bore.pub:46087
# ```
#
# This exposes localhost:5000 on a random bore.pub port, in this case 46087. (Port 5000 is the default Flask port.)
#
# ```
# WEB_BASE="http://bore.pub:46087" FLASK_APP="flask_web" python3 -m flask run
# ```
#
# The above command runs the web server locally and set the publicly-accessible bore.pub URL.
# With both running you can `curl http://bore.pub:PORT/predict` to visit the same in your browser to create predictions.
#
# Navigating to `http://bore.pub:PORT/` will show these predictions initially in pending before the callback is received
# and prediction result is displayed.
