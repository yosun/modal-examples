import {
  For,
  Show,
  children,
  createEffect,
  createSignal,
  onMount,
} from "https://cdn.skypack.dev/solid-js";

import { render } from "https://cdn.skypack.dev/solid-js/web";
import html from "https://cdn.skypack.dev/solid-js/html";

import RecorderNode from "./recorder-node.js";
// import './loaders.css';

function Layout(props) {
  const c = children(() => props.children);
  return html`
    <div class="absolute inset-0 bg-gray-50 px-2">
      <div class="mx-auto max-w-md py-8 sm:py-16">
        <main class="rounded-xl bg-white p-4 shadow-lg">${c}</main>
      </div>
    </div>
  `;
}

function RecordingSpinner(props) {
  return html`
    <div class="lds-ripple">
      <div></div>
      <div></div>
    </div>
  `;
}

const TYPING_SPEED = 30; // in milliseconds
const SILENT_DELAY = 3000; // in milliseconds

const State = {
  BOT_TALKING: "BOT_TALKING",
  BOT_SILENT: "BOT_SILENT",
  USER_TALKING: "USER_TALKING",
  USER_SILENT: "USER_SILENT",
  WAITING_FOR_BOT: "WAITING_FOR_BOT",
};

class PlayQueue {
  constructor(audioContext) {
    this.call_ids = [];
    this.isPlaying = false;
    this.audioContext = audioContext;
  }

  async add(call_id) {
    this.call_ids.push(call_id);
    this.play();
  }

  async play() {
    if (this.isPlaying || this.call_ids.length === 0) {
      return;
    }

    this.isPlaying = true;
    const call_id = this.call_ids.shift();
    console.log("Fetching audio for call", call_id);

    let response;
    while (true) {
      response = await fetch(`/audio/${call_id}`);
      if (response.status === 202) {
        console.log("Timed out fetching audio, retrying...");
      } else if (!response.ok) {
        throw new Error("Error occurred fetching audio: " + response.status);
      } else {
        break;
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    source.onended = () => {
      this.isPlaying = false;
      this.play();
    };
    source.start();
  }
}

function App() {
  const [chat, setChat] = createSignal([""]);
  const [message, setMessage] = createSignal(
    "Hi! I'm Alpaca running on Modal. Talk to me using your microphone."
  );
  const [state, setState] = createSignal(State.BOT_SILENT);
  const [playQueue, setPlayQueue] = createSignal(null);
  const [recordingTimeoutId, setRecordingTimeoutId] = createSignal(null);
  const [recorderNode, setRecorderNode] = createSignal(null);

  setInterval(() => {
    const c = chat();
    const lastChatMessage = c[c.length - 1];
    if (lastChatMessage.length < message().length) {
      const newChat = [...c];
      newChat[c.length - 1] = message().substring(
        0,
        lastChatMessage.length + 1
      );
      // Message finished.
      if (
        lastChatMessage.length + 1 === message().length &&
        state() === State.BOT_SILENT
      ) {
        newChat.push("");
        setMessage("");
        setState(State.USER_TALKING);
        const node = recorderNode();
        if (node) {
          recorderNode().start();
        }
      }
      setChat(newChat);
    }
  }, TYPING_SPEED);

  const generateResponse = async (warm = false) => {
    const body = warm
      ? { warm: true }
      : { input: message(), history: chat().slice(1, -1) };

    const response = await fetch("/generate", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error("Error occurred during submission: " + response.status);
    }

    if (warm) {
      return;
    }

    setMessage("");
    setChat([...chat(), ""]);
    setState(State.BOT_TALKING);

    const readableStream = response.body;
    const decoder = new TextDecoder();

    const reader = readableStream.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      for (let message of decoder.decode(value).split("\n")) {
        let [type, ...payload] = message.split(": ");
        payload = payload.join(": ");

        if (type == "text") {
          setMessage((m) => m + payload);
        } else if (type == "audio") {
          playQueue().add(payload);
        }
      }
    }

    reader.releaseLock();

    setState(State.BOT_SILENT);
  };

  const onLongSilence = async () => {
    setState((s) => {
      if (s === State.USER_SILENT) {
        if (message().length > 0) {
          console.log("Submitting input");
          recorderNode().stop();
          generateResponse();
          return State.WAITING_FOR_BOT;
        } else {
          setRecordingTimeoutId(setTimeout(onLongSilence, SILENT_DELAY));
        }
      }
      return s;
    });
  };

  const onSilence = async () => {
    setState((s) => {
      if (s === State.USER_TALKING) {
        console.log("Silence detected");
        setRecordingTimeoutId(setTimeout(onLongSilence, SILENT_DELAY));
        return State.USER_SILENT;
      }
      return s;
    });
  };

  createEffect((fired) => {
    if (message() == "What is the meaning of life?" && fired == 0) {
      onLongSilence();
    }
    return 1;
  }, 0);

  const onTalking = async () => {
    setState((s) => {
      if (s === State.USER_SILENT) {
        console.log("Talking detected");
        clearTimeout(recordingTimeoutId());
        return State.USER_TALKING;
        // setMessage("What is the meaning of life?");
      }
      return s;
    });
  };

  const onSegmentRecv = async (buffer) => {
    const blob = new Blob([buffer], { type: "audio/float32" });

    const t0 = performance.now();
    console.log("Sending audio segment");

    const response = await fetch("/transcribe", {
      method: "POST",
      body: blob,
      headers: { "Content-Type": "audio/float32" },
    });

    if (!response.ok) {
      throw new Error(
        "Error occurred during transcription: " + response.status
      );
    }

    const data = await response.json();
    console.log(data, performance.now() - t0);
    setMessage((m) => m + data);
  };

  onMount(async () => {
    // Warm up GPU functions.
    onSegmentRecv(new Float32Array());
    generateResponse(true);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const context = new AudioContext();

    const source = context.createMediaStreamSource(stream);

    await context.audioWorklet.addModule("processor.js");
    const recorderNode = new RecorderNode(
      context,
      onSegmentRecv,
      onSilence,
      onTalking
    );
    setRecorderNode(recorderNode);

    source.connect(recorderNode);
    recorderNode.connect(context.destination);

    setPlayQueue(new PlayQueue(context));
  });

  return html`
    <${Layout}>
      <${For} each=${chat}>
        ${(msg, i) => html`
          <div class=${"flex " + (i() % 2 ? "justify-end" : "justify-start")}>
            <${Show}
              when=${i() == chat.length - 1 && state() == State.USER_TALKING}
            >
              <${RecordingSpinner} />
            <//>
            <div
              class=${"rounded-[16px] px-3 py-1.5 " +
              (i() % 2 ? "bg-indigo-500 text-white ml-8" : "bg-gray-100 mr-8")}
            >
              ${msg}
            </div>
          </div>
        `}
      <//>
    <//>
  `;
}

render(App, document.body);
