import {
  children,
  onMount,
  createSignal,
} from "https://cdn.skypack.dev/solid-js";

import { render } from "https://cdn.skypack.dev/solid-js/web";
import html from "https://cdn.skypack.dev/solid-js/html";
import RecorderNode from "./recorder-node.js";

function Layout(props) {
  const c = children(() => props.children);
  return html`
    <div class="absolute inset-0 bg-gray-50 px-2">
      <div class="mx-auto max-w-md py-8 sm:py-16">
        <main class="rounded-xl bg-white p-4 shadow-lg">
          <h1 class="text-center text-2xl font-semibold">
            Talk to${" "}
            <a href="https://modal.com" class="text-lime-700">Modal</a>${" "}
            Transformer
          </h1>
          ${c}
        </main>
      </div>
    </div>
  `;
}

function App() {
  const [input, setInput] = createSignal("");

  const transcribeSegment = async (buffer) => {
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

    // You can process the response here, e.g., convert it to JSON or text.
    const data = await response.json();
    console.log(data, performance.now() - t0);
    setInput((i) => i + data);
  };

  onMount(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);

    await context.audioWorklet.addModule("processor.js");
    const recorderNode = new RecorderNode(context, transcribeSegment);

    source.connect(recorderNode);
    recorderNode.connect(context.destination);

    // Warm up GPU function.
    transcribeSegment(new Float32Array());
  });

  return html`
    <${Layout}>
      <div>${input}</div>
    <//>
  `;
}

render(App, document.body);
