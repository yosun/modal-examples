import RecorderNode from "./recorder-node.js";

const { useState, useEffect, useCallback, useRef } = React;

const { createMachine, assign } = XState;
const { useMachine } = XStateReact;

const SILENT_DELAY = 3000; // in milliseconds
const INITIAL_MESSAGE =
  "Hi! I'm a language model running on Modal. Talk to me using your microphone.";
const TTS_ENABLED = true;

const INDICATOR_TYPE = {
  TALKING: "talking",
  SILENT: "silent",
  GENERATING: "generating",
  IDLE: "idle",
};

const MODELS = [
  { id: "vicuna-13b-4bit", label: "Vicuna 13B (4-bit)" },
  { id: "alpaca-lora-7b", label: "Alpaca LORA 7B" },
];

const chatMachine = createMachine(
  {
    initial: "botDone",
    context: {
      pendingSegments: 0,
      transcript: "",
      messages: 1,
    },
    states: {
      botGenerating: {
        on: {
          GENERATION_DONE: { target: "botDone", actions: "resetTranscript" },
        },
      },
      botDone: {
        on: {
          TYPING_DONE: {
            target: "userSilent",
            actions: ["resetPendingSegments", "incrementMessages"],
          },
          SEGMENT_RECVD: {
            target: "userTalking",
            actions: [
              "resetPendingSegments",
              "segmentReceive",
              "incrementMessages",
            ],
          },
        },
      },
      userTalking: {
        on: {
          SILENCE: { target: "userSilent" },
          SEGMENT_RECVD: { actions: "segmentReceive" },
          TRANSCRIPT_RECVD: { actions: "transcriptReceive" },
        },
      },
      userSilent: {
        on: {
          SOUND: { target: "userTalking" },
          SEGMENT_RECVD: { actions: "segmentReceive" },
          TRANSCRIPT_RECVD: { actions: "transcriptReceive" },
        },
        after: [
          {
            delay: SILENT_DELAY,
            target: "botGenerating",
            actions: "incrementMessages",
            cond: "canGenerate",
          },
          {
            delay: SILENT_DELAY,
            target: "userSilent",
          },
        ],
      },
    },
  },
  {
    actions: {
      segmentReceive: assign({
        pendingSegments: (context) => context.pendingSegments + 1,
      }),
      transcriptReceive: assign({
        pendingSegments: (context) => context.pendingSegments - 1,
        transcript: (context, event) => {
          console.log(context, event);
          return context.transcript + event.transcript;
        },
      }),
      resetPendingSegments: assign({ pendingSegments: 0 }),
      incrementMessages: assign({
        messages: (context) => context.messages + 1,
      }),
      resetTranscript: assign({ transcript: "" }),
    },
    guards: {
      canGenerate: (context) => {
        console.log(context);
        return context.pendingSegments === 0 && context.transcript.length > 0;
      },
    },
  }
);

function Sidebar({ selected, onModelSelect }) {
  return (
    <nav className="bg-gray-900 w-[400px] flex flex-col h-full gap-2 p-2 text-gray-100">
      <h1 className="text-4xl font-semibold text-center text-gray-600 ml-auto mr-auto flex gap-2 items-center justify-center h-20">
        ChatModal
        <span className="bg-orange-200 text-orange-900 py-0.5 px-1.5 text-xs rounded-md uppercase">
          Plus
        </span>
      </h1>
      {MODELS.map(({ id, label }) => (
        <button
          key={id}
          className={
            "py-2 items-center justify-center rounded-md cursor-pointer " +
            (id == selected ? "bg-teal-800" : "hover:bg-teal-900")
          }
          onClick={() => onModelSelect(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function BotIcon() {
  return (
    <svg
      className="w-8 h-8 min-w-8 min-h-8 fill-slate-300"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 640 512"
    >
      {/*! Font Awesome Pro 6.4.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2023 Fonticons, Inc.*/}
      <path d="M320 0c17.7 0 32 14.3 32 32V96H472c39.8 0 72 32.2 72 72V440c0 39.8-32.2 72-72 72H168c-39.8 0-72-32.2-72-72V168c0-39.8 32.2-72 72-72H288V32c0-17.7 14.3-32 32-32zM208 384c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H208zm96 0c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H304zm96 0c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H400zM264 256a40 40 0 1 0 -80 0 40 40 0 1 0 80 0zm152 40a40 40 0 1 0 0-80 40 40 0 1 0 0 80zM48 224H64V416H48c-26.5 0-48-21.5-48-48V272c0-26.5 21.5-48 48-48zm544 0c26.5 0 48 21.5 48 48v96c0 26.5-21.5 48-48 48H576V224h16z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      className="w-8 h-8 min-w-8 min-h-8 fill-cyan-600"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 448 512"
    >
      {/*! Font Awesome Pro 6.4.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2023 Fonticons, Inc.*/}
      <path d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z" />
    </svg>
  );
}

function TalkingSpinner() {
  return (
    <div className={"flex items-center justify-center"}>
      <div className="talking [&>span]:bg-orange-500">
        {" "}
        <span /> <span /> <span />{" "}
      </div>
    </div>
  );
}

function SilentIcon() {
  return (
    <div className={"flex items-center justify-center"}>
      <div className="silent [&>span]:bg-orange-500">
        {" "}
        <span /> <span /> <span />{" "}
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="scale-[0.2] w-6 h-6 flex items-center justify-center">
      <div className="lds-spinner">
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
        <div></div>
      </div>
    </div>
  );
}

function ChatMessage({ text, isUser, indicator }) {
  return (
    <div className="w-full">
      <div className="text-base gap-4 p-4 flex m-auto">
        <div className="flex flex-col gap-2">
          <div className="items-center justify-center">
            {isUser ? <UserIcon /> : <BotIcon />}
          </div>
          {indicator == INDICATOR_TYPE.TALKING && <TalkingSpinner />}
          {indicator == INDICATOR_TYPE.GENERATING && <LoadingSpinner />}
          {/* {indicator == INDICATOR_TYPE.SILENT && <SilentIcon />} */}
        </div>
        <div>
          <div
            className={
              "whitespace-pre-wrap rounded-[16px] px-3 py-1.5 text-gray-100 max-w-[600px]" +
              (isUser ? " bg-gray-700" : " bg-cyan-700") +
              (!text ? " bg-gray-600 text-sm italic" : "")
            }
          >
            {text ||
              (isUser
                ? "Speak into your microphone to talk to the bot..."
                : "Bot is typing...")}
          </div>
        </div>
      </div>
    </div>
  );
}

class PlayQueue {
  constructor(audioContext, onChange) {
    this.call_ids = [];
    this.state = INDICATOR_TYPE.IDLE;
    this.audioContext = audioContext;
    this._onChange = onChange;
  }

  async add(call_id) {
    this.call_ids.push(call_id);
    this.play();
  }

  async play() {
    if (this.state != INDICATOR_TYPE.IDLE || this.call_ids.length === 0) {
      return;
    }

    this.state = INDICATOR_TYPE.GENERATING;
    this._onChange(this.state);

    const call_id = this.call_ids.shift();
    console.log("Fetching audio for call", call_id);

    let response;
    while (true) {
      response = await fetch(`/audio/${call_id}`);
      if (response.status === 202) {
        continue;
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
      this.state = INDICATOR_TYPE.IDLE;
      this._onChange(this.state);
      this.play();
    };

    this.state = INDICATOR_TYPE.TALKING;
    this._onChange(this.state);
    source.start();
  }

  clear() {
    for (const call_id of this.call_ids) {
      fetch(`/audio/${call_id}`, { method: "DELETE" });
    }
    this.call_ids = [];
  }
}

async function fetchTranscript(buffer) {
  const blob = new Blob([buffer], { type: "audio/float32" });

  const response = await fetch("/transcribe", {
    method: "POST",
    body: blob,
    headers: { "Content-Type": "audio/float32" },
  });

  if (!response.ok) {
    throw new Error("Error occurred during transcription: " + response.status);
  }

  return await response.json();
}

async function* fetchGeneration(noop, input, history) {
  const body = noop
    ? { noop: true, tts: TTS_ENABLED }
    : { input, history, tts: TTS_ENABLED };

  const response = await fetch("/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("Error occurred during submission: " + response.status);
  }

  if (noop) {
    return;
  }

  const readableStream = response.body;
  const decoder = new TextDecoder();

  const reader = readableStream.getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    for (let message of decoder.decode(value).split("\x1e")) {
      if (message.length === 0) {
        continue;
      }

      let { type, value: payload } = JSON.parse(message);

      if (type == "text") {
        yield { type: "text", payload };
      } else if (type == "audio") {
        yield { type: "audio", payload };
      }
    }
  }

  reader.releaseLock();
}

function App() {
  const [history, setHistory] = useState([]);
  const [fullMessage, setFullMessage] = useState(INITIAL_MESSAGE);
  const [typedMessage, setTypedMessage] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [botIndicator, setBotIndicator] = useState(INDICATOR_TYPE.IDLE);
  const [state, send, service] = useMachine(chatMachine);
  const recorderNodeRef = useRef(null);
  const playQueueRef = useRef(null);

  useEffect(() => {
    const subscription = service.subscribe((state, event) => {
      console.log("Transitioned to state:", state.value, state.context);

      if (event && event.type == "TRANSCRIPT_RECVD") {
        setFullMessage(
          (m) => m + (m ? event.transcript : event.transcript.trimStart())
        );
      }
    });

    return subscription.unsubscribe;
  }, [service]);

  const generateResponse = useCallback(
    async (noop, input = "") => {
      if (!noop) {
        recorderNodeRef.current.stop();
      }

      console.log("Generating response", input, history);

      let firstAudioRecvd = false;
      for await (let { type, payload } of fetchGeneration(
        noop,
        input,
        history.slice(1)
      )) {
        if (type === "text") {
          setFullMessage((m) => m + payload);
        } else if (type === "audio") {
          if (!firstAudioRecvd) {
            playQueueRef.current.clear();
            firstAudioRecvd = true;
          }
          playQueueRef.current.add(payload);
        }
      }
      console.log("Finished generating response");

      if (!noop) {
        recorderNodeRef.current.start();
        send("GENERATION_DONE");
      }
    },
    [history]
  );

  useEffect(() => {
    const transition = state.context.messages > history.length + 1;

    if (transition && state.matches("botGenerating")) {
      generateResponse(/* noop = */ false, fullMessage);
    }

    if (transition) {
      setHistory((h) => [...h, fullMessage]);
      setFullMessage("");
      setTypedMessage("");
    }
  }, [state, history, fullMessage]);

  const onSegmentRecv = useCallback(
    async (buffer) => {
      if (buffer.length) {
        send("SEGMENT_RECVD");
      }
      // TODO: these can get reordered
      const data = await fetchTranscript(buffer);
      if (buffer.length) {
        send({ type: "TRANSCRIPT_RECVD", transcript: data });
      }
    },
    [history]
  );

  async function onMount() {
    // Warm up GPU functions.
    onSegmentRecv(new Float32Array());
    generateResponse(/* noop = */ true);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const context = new AudioContext();

    const source = context.createMediaStreamSource(stream);

    await context.audioWorklet.addModule("processor.js");
    const recorderNode = new RecorderNode(
      context,
      onSegmentRecv,
      () => send("SILENCE"),
      () => send("SOUND")
    );
    recorderNodeRef.current = recorderNode;

    source.connect(recorderNode);
    recorderNode.connect(context.destination);

    playQueueRef.current = new PlayQueue(context, setBotIndicator);
  }

  useEffect(() => {
    onMount();
  }, []);

  useEffect(() => {
    console.log("Bot indicator changed", botIndicator);
  }, [botIndicator]);

  const tick = useCallback(() => {
    if (!recorderNodeRef.current) {
      return;
    }

    if (typedMessage.length < fullMessage.length) {
      const n = 1; // Math.round(Math.random() * 3) + 3;
      setTypedMessage(fullMessage.substring(0, typedMessage.length + n));

      if (typedMessage.length + n == fullMessage.length) {
        send("TYPING_DONE");
      }
    }
  }, [typedMessage, fullMessage]);

  useEffect(() => {
    const intervalId = setInterval(tick, 20);
    return () => clearInterval(intervalId);
  }, [tick]);

  const onModelSelect = (id) => {
    setModel(id);
  };

  const isUserLast = history.length % 2 == 1;
  let userIndicator = INDICATOR_TYPE.IDLE;

  if (isUserLast) {
    userIndicator = state.matches("userTalking")
      ? INDICATOR_TYPE.TALKING
      : INDICATOR_TYPE.SILENT;
  }

  return (
    <div className="min-w-full min-h-screen screen">
      <div className="w-full h-screen flex">
        <Sidebar selected={model} onModelSelect={onModelSelect} />
        <main className="bg-gray-800 w-full flex flex-col items-center gap-6 pt-6 overflow-auto">
          {history.map((msg, i) => (
            <ChatMessage
              key={i}
              text={msg}
              isUser={i % 2 == 1}
              indicator={
                isUserLast && i == history.length - 1 ? botIndicator : undefined
              }
            />
          ))}
          <ChatMessage
            text={typedMessage}
            isUser={isUserLast}
            indicator={isUserLast ? userIndicator : botIndicator}
          />
        </main>
      </div>
    </div>
  );
}

const container = document.getElementById("react");
ReactDOM.createRoot(container).render(<App />);
