import RecorderNode from "./recorder-node.js";

const { useState, useEffect, useCallback, useRef } = React;

const { createMachine, assign } = XState;
const { useMachine } = XStateReact;

const SILENT_DELAY = 3000; // in milliseconds
const INITIAL_MESSAGE =
  "Hi! I'm Alpaca running on Modal. Talk to me using your microphone.";

const chatMachine = createMachine(
  {
    initial: "botDone",
    context: {
      pendingSegments: 0,
      transcriptLength: 0,
      messages: 1,
    },
    states: {
      botGenerating: {
        on: {
          GENERATION_DONE: { target: "botDone" },
        },
      },
      botDone: {
        on: {
          SOUND: { target: "userTalking", actions: "incrementMessages" },
        },
      },
      userTalking: {
        on: {
          SILENCE: { target: "userSilent" },
          SEGMENT_RECVD: {
            target: "waitingForTranscript",
            actions: "resetPendingSegments",
          },
        },
      },
      userSilent: {
        on: {
          SOUND: { target: "userTalking" },
          SEGMENT_RECVD: {
            target: "waitingForTranscript",
            actions: "resetPendingSegments",
          },
        },
        after: {
          [SILENT_DELAY]: {
            target: "botGenerating",
            actions: "incrementMessages",
          },
        },
      },
      waitingForTranscript: {
        on: {
          SEGMENT_RECVD: { actions: "segmentReceive" },
          TRANSCRIPT_RECVD: [
            {
              cond: "hasNoPendingSegments",
              target: "userSilent",
              actions: "transcriptReceive",
            },
            { actions: "transcriptReceive" },
          ],
        },
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
        transcriptLength: (context, event) =>
          context.transcriptLength + event.data.length,
      }),
      resetPendingSegments: assign({ pendingSegments: () => 1 }),
      incrementMessages: assign({
        messages: (context) => context.messages + 1,
      }),
    },
    guards: {
      hasNoPendingSegments: (context) => context.pendingSegments === 0,
      nonEmptyTranscript: (context) => context.transcriptLength > 0,
    },
  }
);

function Layout({ children }) {
  return (
    <div className="absolute inset-0 bg-gray-50 px-2">
      <div className="mx-auto max-w-md py-8 sm:py-16">
        <main className="rounded-xl bg-white p-4 shadow-lg">{children}</main>
      </div>
    </div>
  );
}

function ChatMessage({ text, isUser }) {
  return (
    <div className={"flex " + (isUser ? "justify-end" : "justify-start")}>
      <div
        className={
          "rounded-[16px] px-3 py-1.5 " +
          (isUser ? "bg-indigo-500 text-white ml-8" : "bg-gray-100 mr-8")
        }
      >
        {text}
      </div>
    </div>
  );
}

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
      this.isPlaying = false;
      this.play();
    };
    source.start();
  }

  clear() {
    // TODO: cancel calls on the backend somehow?
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

function App() {
  const [history, setHistory] = useState([]);
  const [fullMessage, setFullMessage] = useState(INITIAL_MESSAGE);
  const [typedMessage, setTypedMessage] = useState("");
  const [state, send, service] = useMachine(chatMachine);
  const recorderNodeRef = useRef(null);
  const playQueueRef = useRef(null);

  // useEffect(() => {
  //   const subscription = service.subscribe((state) => {
  //     console.log("Transitioned to state:", state.value, state.context);
  //   });

  //   return subscription.unsubscribe;
  // }, [service]);

  const generateResponse = useCallback(
    async (input) => {
      console.log("Generating response", input, history);

      const warm = input.length === 0;
      const body = warm ? { warm: true } : { input, history: history.slice(1) };

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

      const readableStream = response.body;
      const decoder = new TextDecoder();

      const reader = readableStream.getReader();
      let firstAudioRecvd = false;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        for (let message of decoder.decode(value).split("\n")) {
          let [type, ...payload] = message.split(": ");
          payload = payload.join(": ");

          if (type == "text") {
            setFullMessage((m) => m + payload);
          } else if (type == "audio") {
            if (!firstAudioRecvd) {
              playQueueRef.current.clear();
              firstAudioRecvd = true;
            }
            playQueueRef.current.add(payload);
          }
        }
      }

      reader.releaseLock();

      send("GENERATION_DONE");
    },
    [history]
  );

  useEffect(() => {
    const transition = state.context.messages > history.length + 1;

    if (transition && state.matches("botGenerating")) {
      generateResponse(fullMessage);
    }

    if (transition) {
      setHistory((h) => [...h, fullMessage]);
      setFullMessage("");
      setTypedMessage("");
    }
  }, [state, history, fullMessage]);

  const onSegmentRecv = async (buffer) => {
    send("SEGMENT_RECVD");
    const data = await fetchTranscript(buffer);
    setFullMessage((m) => m + data);
    send({ type: "TRANSCRIPT_RECVD", data });
  };

  async function onMount() {
    // Warm up GPU functions.
    onSegmentRecv(new Float32Array());
    generateResponse("");

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

    playQueueRef.current = new PlayQueue(context);
  }

  useEffect(() => {
    onMount();
  }, []);

  const tick = useCallback(() => {
    if (!recorderNodeRef.current) {
      return;
    }

    if (typedMessage.length < fullMessage.length) {
      const n = Math.round(Math.random() * 3) + 3;
      setTypedMessage(fullMessage.substring(0, typedMessage.length + n));
    }
  }, [typedMessage, fullMessage]);

  useEffect(() => {
    const intervalId = setInterval(tick, 100);
    return () => clearInterval(intervalId);
  }, [tick]);

  return (
    <Layout>
      {history.map((msg, i) => (
        <ChatMessage key={i} text={msg} isUser={i % 2 == 1} />
      ))}
      <ChatMessage text={typedMessage} isUser={history.length % 2 == 1} />
    </Layout>
  );
}

const container = document.getElementById("react");
ReactDOM.createRoot(container).render(<App />);
