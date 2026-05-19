import { AudioStreamer } from "./audioStreamer";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";

export type SessionState = "disconnected" | "connecting" | "listening" | "speaking";

export class LiveSession {
  private session: any = null;
  private streamer: AudioStreamer;
  
  public state: SessionState = "disconnected";
  public onStateChange: ((state: SessionState) => void) | null = null;
  public onToolCall: ((toolCall: any) => void) | null = null;
  public onError: ((errorMsg: string) => void) | null = null;

  constructor() {
    this.streamer = new AudioStreamer();
    this.streamer.onAudioData = (base64) => {
      this.sendAudio(base64);
    };
  }

  private setState(newState: SessionState) {
    this.state = newState;
    if (this.onStateChange) this.onStateChange(newState);
  }

  async connect(options?: { geminiKey?: string, openRouterKey?: string }) {
    if (this.state !== "disconnected") return;
    this.setState("connecting");

    try {
      await this.streamer.initAndStart();
    } catch (err: any) {
      console.error("Failed to start audio capture:", err);
      this.disconnect();
      let errorMsg = err.message || "Microphone permission denied.";
      if (err.name === "NotAllowedError" || errorMsg.toLowerCase().includes("permission denied")) {
         errorMsg = "Microphone access denied. Please open the app in a new tab and allow permissions.";
      }
      if (this.onError) this.onError(errorMsg);
      return;
    }

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = new URL(`${protocol}//${location.host}/live`);
    if (options?.geminiKey) wsUrl.searchParams.set("geminiKey", options.geminiKey);
    // Note: server.ts will fallback to process.env.GEMINI_API_KEY if geminiKey is not provided

    this.session = new WebSocket(wsUrl.toString());

    this.session.onopen = async () => {
      this.setState("listening");
    };

    this.session.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.error) {
          console.error("Server error:", msg.error);
          if (this.onError) this.onError(msg.error);
          this.disconnect();
          return;
        }

        if (msg.audio) {
          this.setState("speaking");
          this.streamer.playAudioChunk(msg.audio);
          
          clearTimeout((this as any).speakingTimeout);
          (this as any).speakingTimeout = setTimeout(() => {
             if (this.state === "speaking") this.setState("listening");
          }, 300);
        }

        if (msg.interrupted) {
          this.streamer.clearPlaybackQueue();
          this.setState("listening");
        }

        if (msg.toolCall) {
          if (this.onToolCall) this.onToolCall(msg.toolCall);
        }
      } catch (err) {
        console.error("Error parsing WS message:", err);
      }
    };

    this.session.onclose = (e: CloseEvent) => {
      if (e.code !== 1000 && e.code !== 1005) {
        console.error(`WebSocket closed with code ${e.code}, reason: ${e.reason}`);
        if (this.onError) this.onError(`Connection lost: ${e.reason || 'Unknown error code ' + e.code}`);
      }
      this.disconnect();
    };
  }

  sendAudio(base64: string) {
    if (this.session && this.session.readyState === WebSocket.OPEN) {
      this.session.send(JSON.stringify({ audio: base64 }));
    }
  }

  sendToolResponse(functionResponses: any[]) {
     if (this.session && this.session.readyState === WebSocket.OPEN) {
        this.session.send(JSON.stringify({ toolResponse: { functionResponses } }));
     }
  }

  disconnect() {
    if (this.session && typeof this.session.close === 'function') {
      try { this.session.close(); } catch(e) {}
    }
    this.session = null;
    this.streamer.stop();
    this.setState("disconnected");
  }
}
