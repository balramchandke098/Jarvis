import { AudioStreamer } from "./audioStreamer";

export type SessionState = "disconnected" | "connecting" | "listening" | "speaking";

export class LiveSession {
  private ws: WebSocket | null = null;
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
    if (options?.openRouterKey) wsUrl.searchParams.set("openRouterKey", options.openRouterKey);

    this.ws = new WebSocket(wsUrl.toString());

    this.ws.onopen = async () => {
      this.setState("listening");
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.error) {
          console.error("Server error:", msg.error);
          this.disconnect();
          return;
        }

        if (msg.audio) {
          this.setState("speaking");
          this.streamer.playAudioChunk(msg.audio);
          
          // Note: When audio is done, it could return to "listening". 
          // A full implementation would track when playback finishes, but simple timeout fallback works:
          clearTimeout((this as any).speakingTimeout);
          (this as any).speakingTimeout = setTimeout(() => {
             if (this.state === "speaking") this.setState("listening");
          }, 300); // go back to listening after 300ms of no audio chunks 
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

    this.ws.onclose = () => {
      this.disconnect();
    };
  }

  sendAudio(base64: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ audio: base64 }));
    }
  }

  sendToolResponse(functionResponses: any[]) {
     if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
     }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.streamer.stop();
    this.setState("disconnected");
  }
}
