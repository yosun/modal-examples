from pathlib import Path

import modal

from .common import stub
from .llm import Vicuna
from .transcriber import Whisper
from .tts import Tortoise

static_path = Path(__file__).with_name("frontend").resolve()


@stub.function(
    mounts=[modal.Mount.from_local_dir(static_path, remote_path="/assets")],
    container_idle_timeout=300,
    timeout=600,
)
@stub.asgi_app()
def web():
    from fastapi import FastAPI, Request
    from fastapi.responses import Response, StreamingResponse
    from fastapi.staticfiles import StaticFiles

    web_app = FastAPI()
    transcriber = Whisper()
    llm = Vicuna()
    tts = Tortoise()

    @web_app.post("/transcribe")
    async def transcribe(request: Request):
        bytes = await request.body()
        result = transcriber.transcribe_segment.call(bytes)
        return result["text"]

    @web_app.post("/generate")
    async def generate(request: Request):
        body = await request.json()

        if "noop" in body:
            llm.generate.spawn("")
            # Warm up 3 containers for now.
            for _ in range(3):
                tts.speak.spawn("")
            return

        def generate():
            sentence = ""

            for segment in llm.generate.call(body["input"], body["history"]):
                yield f"text: {segment}\n"
                sentence += segment
                if "." in sentence:
                    prev_sentence, new_sentence = sentence.rsplit(".", 1)
                    function_call = tts.speak.spawn(prev_sentence)
                    yield f"audio: {function_call.object_id}\n"
                    sentence = new_sentence

            if sentence:
                function_call = tts.speak.spawn(sentence)
                yield f"audio: {function_call.object_id}\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
        )

    @web_app.get("/audio/{call_id}")
    async def get_audio(call_id: str):
        from modal.functions import FunctionCall

        function_call = FunctionCall.from_id(call_id)
        try:
            result = function_call.get(timeout=30)
        except TimeoutError:
            return Response(status_code=202)

        return StreamingResponse(result, media_type="audio/wav")

    web_app.mount("/", StaticFiles(directory="/assets", html=True))
    return web_app
