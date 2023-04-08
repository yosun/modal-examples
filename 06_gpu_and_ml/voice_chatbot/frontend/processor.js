class WorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 480000; // 10 seconds * 48000 samples/second
    this._buffer = new Float32Array(this._bufferSize);
    this._writeIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const channelData = inputs[0][0];
    const remainingBufferSize = this._bufferSize - this._writeIndex;

    if (remainingBufferSize >= channelData.length) {
      this._buffer.set(channelData, this._writeIndex);
      this._writeIndex += channelData.length;
    } else {
      this._buffer.set(
        channelData.subarray(0, remainingBufferSize),
        this._writeIndex
      );
      this.port.postMessage({ type: "bufferFilled", buffer: this._buffer });

      this._buffer.set(channelData.subarray(remainingBufferSize), 0);
      this._writeIndex = channelData.length - remainingBufferSize;
    }

    return true;
  }
}

registerProcessor("worklet-processor", WorkletProcessor);
