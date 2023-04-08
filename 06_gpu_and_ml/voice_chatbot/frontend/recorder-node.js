class RecorderNode extends AudioWorkletNode {
  constructor(context, onBufferFilled) {
    super(context, "worklet-processor");
    this.port.onmessage = (event) => {
      if (event.data.type === "bufferFilled") {
        onBufferFilled(event.data.buffer);
      }
    };
  }
}

export default RecorderNode;
