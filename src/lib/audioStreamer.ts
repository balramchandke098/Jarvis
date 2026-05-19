import {
  float32ToPcm16,
  pcm16ToFloat32,
  pcmToBase64,
  base64ToPcm16,
} from "./pcm";

export class AudioStreamer {
  private audioCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;

  public isRecording = false;
  private nextStartTime = 0;
  
  // Callback when we have a microphone chunk to send
  public onAudioData: ((base64: string) => void) | null = null;

  async initAndStart() {
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    await this.audioCtx.resume();
    this.nextStartTime = this.audioCtx.currentTime;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    
    // ScriptProcessorNode is deprecated but stable for simple raw PCM extraction.
    // 4096 buffer = ~256ms at 16kHz
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    
    this.processor.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const pcm16 = float32ToPcm16(float32);
      const base64 = pcmToBase64(pcm16);
      if (this.onAudioData) this.onAudioData(base64);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
    this.isRecording = true;
  }

  stopRecording() {
    this.isRecording = false;
  }

  resumeRecording() {
    this.isRecording = true;
  }

  playAudioChunk(data: string | Uint8Array) {
    if (!this.audioCtx) return;

    let pcm16;
    if (typeof data === "string") {
      pcm16 = base64ToPcm16(data);
    } else if (data instanceof Uint8Array) {
      // Direct binary to pcm16
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      pcm16 = new Int16Array(buffer);
    } else {
      return;
    }

    const float32 = pcm16ToFloat32(pcm16);
    // Response audio from Live API is 24kHz
    const buffer = this.audioCtx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioCtx.destination);

    if (this.nextStartTime < this.audioCtx.currentTime) {
      this.nextStartTime = this.audioCtx.currentTime;
    }
    
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  clearPlaybackQueue() {
    if (!this.audioCtx) return;
    this.nextStartTime = this.audioCtx.currentTime;
    // We cannot easily stop previously scheduled ScriptProcessor nodes without keeping track of them.
    // But setting nextStartTime to currentTime ensures the next chunk plays immediately, overwriting the queue effect.
  }

  stop() {
    this.isRecording = false;
    if (this.processor && this.source) {
      this.processor.disconnect();
      this.source.disconnect();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
