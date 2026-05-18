import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { createServer } from "http";

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  // Create an HTTP server to attach WebSocket server
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/live" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is missing. Add it to continue.");
  }
  
  const ai = new GoogleGenAI({
    apiKey: apiKey || "",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  wss.on("connection", async (clientWs, req) => {
    let clientGeminiKey = "";
    if (req.url) {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      clientGeminiKey = url.searchParams.get("geminiKey") || "";
    }
    const finalApiKey = clientGeminiKey || apiKey || "";

    if (!finalApiKey) {
      clientWs.send(JSON.stringify({ error: "API key is missing on the server and no custom key provided." }));
      clientWs.close();
      return;
    }

    try {
      const aiInstance = new GoogleGenAI({
        apiKey: finalApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const session = await aiInstance.live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ audio }));
            }
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (message.toolCall) {
              clientWs.send(JSON.stringify({ toolCall: message.toolCall }));
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO], // Only Audio
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

      clientWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.audio) {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
            });
          }
          if (msg.toolResponse) {
             // Pass back the toolResponse exactly as received
             if (typeof (session as any).sendToolResponse === 'function') {
               (session as any).sendToolResponse({
                 functionResponses: msg.toolResponse.functionResponses
               });
             } else if (typeof (session as any).sendRealtimeInput === 'function') {
               // Fallback if SDK requires it differently
               const toolMsgKeys = Object.keys(msg.toolResponse);
               if (toolMsgKeys.includes('functionResponses')) {
                  (session as any).sendRealtimeInput({
                      toolResponse: { functionResponses: msg.toolResponse.functionResponses }
                  });
               } else {
                 (session as any).sendRealtimeInput(msg.toolResponse);
               }
             }
          }
        } catch (err) {
          console.error("Error processing client message", err);
        }
      });

      clientWs.on("close", () => {
         if (typeof (session as any).close === 'function') {
           (session as any).close();
         }
      });

      clientWs.send(JSON.stringify({ state: "connected" }));

    } catch (err) {
      console.error("Failed to connect to Gemini Live API:", err);
      clientWs.send(JSON.stringify({ error: "Failed to connect to Gemini API" }));
      clientWs.close();
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
