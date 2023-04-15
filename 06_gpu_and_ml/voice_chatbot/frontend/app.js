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

async function tryPlayAudio(context, buffer) {
  // const buffer = flattenArrayBuffers(buffers);
  const audioBuffer = await context.decodeAudioData(buffer);

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  source.start();
}

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

function App() {
  const [chat, setChat] = createSignal([""]);
  const [message, setMessage] = createSignal(
    "Hi! I'm Alpaca running on Modal. Talk to me using your microphone."
  );
  const [state, setState] = createSignal(State.BOT_SILENT);
  const [recordingTimeoutId, setRecordingTimeoutId] = createSignal(null);
  const [recorderNode, setRecorderNode] = createSignal(null);
  const [audioContext, setAudioContext] = createSignal(null);

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

  const submitInput = async (warm = false) => {
    const body = warm
      ? { warm: true }
      : { input: message(), history: chat().slice(1, -1) };

    const response = await fetch("/submit", {
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

    const context = audioContext();

    setMessage("");
    setChat([...chat(), ""]);
    setState(State.BOT_TALKING);

    const readableStream = response.body;
    const decoder = new TextDecoder();

    const reader = readableStream.getReader();

    // Stream text
    let textDone = false;
    while (!textDone) {
      const { value } = await reader.read();

      for (let message of decoder.decode(value).split("\n")) {
        if (message == "text_done") {
          textDone = true;
        } else if (message.length > 0) {
          setMessage((m) => m + message.split("text: ")[1]);
        }
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      console.log(done, value);

      if (done) {
        break;
      }

      // 13-byte header in our hand-rolled protocol.
      const message = decoder.decode(value.subarray(0, 13));

      const numBytes = +message.split("wav: ")[1];

      let bytesRecvd = 0;

      const array = new Uint8Array(numBytes);
      array.set(value.subarray(14), 0);
      bytesRecvd += value.byteLength - 14;

      while (bytesRecvd < numBytes) {
        const { done, value } = await reader.read();

        array.set(value, bytesRecvd);
        bytesRecvd += value.byteLength;
      }

      await tryPlayAudio(context, array.buffer);
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
          submitInput();
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
        // console.log("Talking detected");
        // clearTimeout(recordingTimeoutId());
        // return State.USER_TALKING;
        setMessage("What is the meaning of life?");
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
    submitInput(true);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const context = new AudioContext();
    setAudioContext(context);

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
