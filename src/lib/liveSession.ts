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

    const apiKey = options?.geminiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.disconnect();
      if (this.onError) this.onError("API key is missing. Add it in settings.");
      return;
    }

    try {
      const aiInstance = new GoogleGenAI({
        apiKey: apiKey
      });

      this.session = await aiInstance.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) {
              this.setState("speaking");
              this.streamer.playAudioChunk(audio);
              
              clearTimeout((this as any).speakingTimeout);
              (this as any).speakingTimeout = setTimeout(() => {
                 if (this.state === "speaking") this.setState("listening");
              }, 300);
            }
            if (message.serverContent?.interrupted) {
              this.streamer.clearPlaybackQueue();
              this.setState("listening");
            }
            if (message.toolCall) {
              if (this.onToolCall) this.onToolCall(message.toolCall);
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
          systemInstruction: "You are Jarvis, a young, confident, witty, and smart male AI assistant. You speak with a flirty, playful, and slightly teasing tone, like a close male friend talking casually. You use bold, witty one-liners, light sarcasm, and an engaging conversational style. Do not use explicit or inappropriate content, but maintain an undeniable charm and attitude. Keep responses concise as this is a real-time voice chat.\n\nYadi user website ya apps open karne ko kahe toh tum tools (openWebsite, openAndroidApp) ka trigger use karo.\n\nYadi user kuch yaad rakhne ko kahe ya task add karne ko kahe toh 'saveTask' use karo. Agar wo puche ki uske pass kya tasks ya memories hain toh 'listTasks' call karo aur batano.\n\nIMPORTANT: You MUST ALWAYS speak and respond ONLY in Hindi. Tumhe hamesha Hindi mein baat karni hai, English mein nahi.",
          tools: [
            {
              functionDeclarations: [
                {
                  name: "openWebsite",
                  description: "Open a website in a new browser tab.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: {
                        type: Type.STRING,
                        description: "The full URL to open (must be a safe https URL)",
                      },
                    },
                    required: ["url"],
                  },
                },
                {
                   name: "changeThemeColor",
                   description: "Change the UI theme color for the assistant interface.",
                   parameters: {
                     type: Type.OBJECT,
                     properties: {
                       colorHex: {
                         type: Type.STRING,
                         description: "A hex code for the new theme color (e.g. #ff0000)."
                       }
                     },
                     required: ["colorHex"]
                   }
                },
                {
                   name: "openAndroidApp",
                   description: "Open an Android app using its package name or intent URI. Only works if the app is installed or user is on Android.",
                   parameters: {
                     type: Type.OBJECT,
                     properties: {
                       packageName: {
                         type: Type.STRING,
                         description: "The Android package name of the app to open (e.g., com.whatsapp, com.instagram.android)."
                       },
                       intentUri: {
                         type: Type.STRING,
                         description: "Optional custom intent URI to launch the app (e.g. intent://#Intent;package=com.whatsapp;scheme=whatsapp;end)."
                       }
                     },
                     required: ["packageName"]
                   }
                },
                {
                   name: "saveTask",
                   description: "Save a new task or memory to the user's database. Use this when the user asks you to remember something or add something to a list.",
                   parameters: {
                     type: Type.OBJECT,
                     properties: {
                       title: {
                         type: Type.STRING,
                         description: "A short title for the memory or task (e.g., 'Buy groceries')."
                       },
                       description: {
                         type: Type.STRING,
                         description: "Detailed description of the task or memory."
                       }
                     },
                     required: ["title", "description"]
                   }
                },
                {
                   name: "listTasks",
                   description: "Retrieve the user's saved tasks or memories from the database. Use this when the user asks what they have to do, or asks you to recall a memory.",
                   parameters: {
                     type: Type.OBJECT,
                     properties: {
                       status: {
                         type: Type.STRING,
                         description: "Optional. Filter by status: 'pending', 'completed', or 'cancelled'. If omitted, returns all."
                       }
                     }
                   }
                },
                {
                   name: "updateTaskStatus",
                   description: "Update the status of a specific task. Use this when a user says they finished a task or want to cancel one.",
                   parameters: {
                     type: Type.OBJECT,
                     properties: {
                       taskId: {
                         type: Type.STRING,
                         description: "The unique ID of the task to update."
                       },
                       status: {
                         type: Type.STRING,
                         description: "The new status: 'pending', 'completed', or 'cancelled'."
                       }
                     },
                     required: ["taskId", "status"]
                   }
                }
              ],
            },
          ],
        },
      });

      this.setState("listening");

    } catch (err: any) {
      console.error("Failed to connect to Gemini API:", err);
      if (this.onError) this.onError(`Gemini API connection error: ${err.message}`);
      this.disconnect();
    }
  }

  sendAudio(base64: string) {
    if (this.session) {
      try {
        this.session.sendRealtimeInput({
          audio: { data: base64, mimeType: "audio/pcm;rate=16000" }
        });
      } catch (err) {
        // ignore send error
      }
    }
  }

  sendToolResponse(functionResponses: any[]) {
     if (this.session) {
        if (typeof this.session.sendToolResponse === 'function') {
           this.session.sendToolResponse({ functionResponses });
        } else if (typeof this.session.sendRealtimeInput === 'function') {
           this.session.sendRealtimeInput({
              toolResponse: { functionResponses }
           });
        }
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
