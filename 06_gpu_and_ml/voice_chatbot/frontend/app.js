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
const SILENT_DELAY = 5000; // in milliseconds

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

  createEffect(() => {
    const timer = setInterval(() => {
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
    return () => clearInterval(timer);
  });

  const submitInput = async (warm = false) => {
    const body = warm ? {} : { input: message() };
    const response = await fetch("/submit", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error("Error occurred during submission: " + response.status);
    }

    const readableStream = response.body;
    const decoder = new TextDecoder();

    if (warm) {
      return;
    }

    setMessage("");
    setChat([...chat(), ""]);
    setState(State.BOT_TALKING);

    // Create a reader to read the stream
    const reader = readableStream.getReader();

    // Process the stream
    while (true) {
      // Read the next chunk
      const { done, value } = await reader.read();

      // If the stream is done, exit the loop
      if (done) {
        break;
      }

      // Process the chunk (e.g., append it to a DOM element, log it, etc.)
      setMessage((m) => m + decoder.decode(value));
    }

    // Close the reader after processing the stream
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

  const onTalking = async () => {
    setState((s) => {
      if (s === State.USER_SILENT) {
        console.log("Talking detected");
        clearTimeout(recordingTimeoutId());
        return State.USER_TALKING;
      }
      return s;
    });
  };

  const onSegmentRecv = async (buffer) => {
    const blob = new Blob([buffer], { type: "audio/float32" });

    const t0 = performance.now();
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
