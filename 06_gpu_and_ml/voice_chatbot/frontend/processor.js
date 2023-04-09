class WorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 480000; // 10 seconds * 48000 samples/second
    this._buffer = new Float32Array(this._bufferSize);
    this._writeIndex = 0;

    this._amplitudeHistorySize = 180; // 128 * 200 / 48000 = ~0.5s
    this._lastAmplitudes = new Array();
    this._amplitudeSum = 0;
  }

  process(inputs, outputs, parameters) {
    const channelData = inputs[0][0];

    const amplitude =
      channelData.reduce((s, v) => s + Math.abs(v), 0) / channelData.length;

    if (this._lastAmplitudes.length >= this._amplitudeHistorySize) {
      const front = this._lastAmplitudes.shift();
      this._amplitudeSum -= front;
    }

    this._lastAmplitudes.push(amplitude);
    this._amplitudeSum += amplitude;

    const averageAmplitude = this._amplitudeSum / this._lastAmplitudes.length;

    this._buffer.set(channelData, this._writeIndex);
    this._writeIndex += channelData.length;
    const remainingBufferSize = this._bufferSize - this._writeIndex;

    if (averageAmplitude < 0.02 || remainingBufferSize < channelData.length) {
      // 2 second minimum
      if (this._writeIndex > 1 * 48000) {
        console.log(
          "Sending segment",
          averageAmplitude,
          remainingBufferSize,
          channelData.length
        );
        // TODO: does this need to be cloned?
        this.port.postMessage({ type: "segment", buffer: this._buffer });
      }
      this._buffer = new Float32Array(this._bufferSize);
      this._writeIndex = 0;
    }

    return true;
  }
}

registerProcessor("worklet-processor", WorkletProcessor);
