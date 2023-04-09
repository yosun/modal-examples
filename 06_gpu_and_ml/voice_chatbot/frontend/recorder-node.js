class RecorderNode extends AudioWorkletNode {
  constructor(context, onSegment) {
    super(context, "worklet-processor");
    this.port.onmessage = (event) => {
      if (event.data.type === "segment") {
        onSegment(event.data.buffer);
      }
    };
  }
}

export default RecorderNode;
