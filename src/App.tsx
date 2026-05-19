/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Loader2, Square, Headphones, Settings, X, Save, LogIn, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { LiveSession, SessionState } from "./lib/liveSession";
import { auth, loginWithGoogle, logout, db } from "./lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, addDoc, getDocs, doc, updateDoc, query, where, serverTimestamp } from "firebase/firestore";

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>("disconnected");
  const [themeColor, setThemeColor] = useState<string>("#22d3ee"); // Default cyan
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const savedGemini = localStorage.getItem("geminiKey") || "";
    const savedOpenRouter = localStorage.getItem("openRouterKey") || "";
    const savedTheme = localStorage.getItem("themeColor") || "#22d3ee";
    setGeminiKey(savedGemini);
    setOpenRouterKey(savedOpenRouter);
    setThemeColor(savedTheme);

    sessionRef.current = new LiveSession();

    sessionRef.current.onStateChange = (state) => {
      setSessionState(state);
      if (state === "connecting") setErrorMessage(null);
    };
    sessionRef.current.onError = (err) => {
      setErrorMessage(err);
    };
    sessionRef.current.onToolCall = async (toolCall) => {
       const functionCalls = toolCall.functionCalls;
       if (!functionCalls) return;

       const functionResponses: any[] = [];
       for (const call of functionCalls) {
          setActiveTool(call.name);
          // Auto-clear active tool display after 3s
          setTimeout(() => setActiveTool(null), 3000);

          if (call.name === "openWebsite") {
             const url = call.args?.url;
             console.log("Opening website", url);
             if (url) {
                // Use a tag for better Android WebView compatibility
                const a = document.createElement('a');
                a.href = url;
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => document.body.removeChild(a), 100);
                functionResponses.push({
                   id: call.id,
                   name: call.name,
                   response: { result: "Website opened successfully." }
                });
             } else {
                functionResponses.push({
                   id: call.id,
                   name: call.name,
                   response: { error: "No URL provided." }
                });
             }
          }
          else if (call.name === "changeThemeColor") {
             const color = call.args?.colorHex;
             console.log("Changing theme color to", color);
             if (color) {
                setThemeColor(color);
                functionResponses.push({
                   id: call.id,
                   name: call.name,
                   response: { result: "Theme color updated successfully." }
                });
             } else {
                functionResponses.push({
                   id: call.id,
                   name: call.name,
                   response: { error: "No color provided." }
                });
             }
          }
          else if (call.name === "openAndroidApp") {
             const packageName = call.args?.packageName;
             const intentUri = call.args?.intentUri;
             console.log("Opening Android app", packageName, intentUri);
             
             const a = document.createElement('a');
             if (intentUri) {
                a.href = intentUri;
             } else if (packageName) {
                a.href = `intent://#Intent;package=${packageName};end`;
             }
             if (a.href) {
                a.target = '_top'; // Best for WebViews to intercept intents
                document.body.appendChild(a);
                a.click();
                setTimeout(() => document.body.removeChild(a), 100);
             }
             
             functionResponses.push({
                id: call.id,
                name: call.name,
                response: { result: "Requested app open intent triggered." }
             });
          }
          else if (call.name === "saveTask") {
             const { title, description } = call.args || {};
             const uid = auth.currentUser?.uid;
             if (!uid) {
                functionResponses.push({ id: call.id, name: call.name, response: { error: "User not logged in." } });
             } else {
                try {
                   const docRef = await addDoc(collection(db, "tasks"), {
                      userId: uid,
                      title: title || "Untitled Task",
                      description: description || "",
                      status: "pending",
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp()
                   });
                   functionResponses.push({ id: call.id, name: call.name, response: { result: "Task saved successfully.", taskId: docRef.id } });
                } catch (err: any) {
                   functionResponses.push({ id: call.id, name: call.name, response: { error: err.message } });
                }
             }
          }
          else if (call.name === "listTasks") {
             const uid = auth.currentUser?.uid;
             if (!uid) {
                functionResponses.push({ id: call.id, name: call.name, response: { error: "User not logged in." } });
             } else {
                try {
                   console.log("Listing tasks for user", uid);
                   const statusFilter = call.args?.status;
                   let q = query(collection(db, "tasks"), where("userId", "==", uid));
                   // Optional: add client side filter for simplicity, or add compound index to use firestore query `where("status", "==", statusFilter)`
                   const snapshot = await getDocs(q);
                   
                   let tasks = snapshot.docs.map(d => ({ taskId: d.id, ...d.data() }));
                   if (statusFilter) {
                       tasks = tasks.filter((t: any) => t.status === statusFilter);
                   }
                   functionResponses.push({ id: call.id, name: call.name, response: { tasks } });
                } catch (err: any) {
                   functionResponses.push({ id: call.id, name: call.name, response: { error: err.message } });
                }
             }
          }
          else if (call.name === "updateTaskStatus") {
             const { taskId, status } = call.args || {};
             const uid = auth.currentUser?.uid;
             if (!uid) {
                functionResponses.push({ id: call.id, name: call.name, response: { error: "User not logged in." } });
             } else {
                try {
                   console.log("Updating task status for task", taskId);
                   const docRef = doc(db, "tasks", taskId);
                   await updateDoc(docRef, {
                       status: status,
                       updatedAt: serverTimestamp()
                   });
                   functionResponses.push({ id: call.id, name: call.name, response: { result: "Task updated successfully." } });
                } catch (err: any) {
                   functionResponses.push({ id: call.id, name: call.name, response: { error: err.message } });
                }
             }
          }
       }

       if (functionResponses.length > 0 && sessionRef.current) {
          sessionRef.current.sendToolResponse(functionResponses);
       }
    };

    return () => {
      if (sessionRef.current) {
        sessionRef.current.disconnect();
      }
    };
  }, []);

  const toggleConnection = useCallback(async () => {
    if (!sessionRef.current) return;
    if (sessionState === "disconnected") {
      if (!user) {
        setErrorMessage("Please login with Google securely first.");
        return;
      }
      
      try {
        setErrorMessage(null);
        // Pre-request microphone permission to ensure it's granted before initializing Live APIs
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (err: any) {
        console.error("Mic permission error:", err);
        setErrorMessage("Microphone permission is required. Please grant audio permission in your browser or app settings.");
        return;
      }

      sessionRef.current.connect({ geminiKey, openRouterKey, userId: user.uid });
    } else {
      sessionRef.current.disconnect();
    }
  }, [sessionState, geminiKey, openRouterKey, user]);

  // Derive visual properties from state
  const isConnected = sessionState !== "disconnected" && sessionState !== "connecting";
  const isSpeaking = sessionState === "speaking";
  const isListening = sessionState === "listening";

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-[#020617] text-slate-200 font-sans selection:bg-cyan-500/30 overflow-hidden relative">
      {/* Background Ambient Glow */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/10 blur-[120px] rounded-full pointer-events-none"></div>

      <AnimatePresence>
        {isConnected && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ 
              opacity: isSpeaking ? 0.3 : 0.05, 
              scale: isSpeaking ? 1.2 : 1 
            }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="absolute inset-0 z-0 m-auto h-[600px] w-[600px] rounded-full blur-[120px] pointer-events-none"
            style={{ backgroundColor: themeColor }}
          />
        )}
      </AnimatePresence>

      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 z-10 w-full shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.4)]">
            <div className="w-4 h-4 border-2 border-white/80 rounded-sm"></div>
          </div>
          <span className="text-xl font-bold tracking-tight text-white uppercase italic">
            Jarvis <span style={{ color: themeColor }}>v2.1</span>
          </span>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-800 px-4 py-1.5 rounded-full">
            <div 
              className="w-2 h-2 rounded-full shadow-[0_0_8px_#10b981]" 
              style={{ 
                backgroundColor: isConnected ? '#10b981' : (sessionState === 'connecting' ? '#f59e0b' : '#ef4444'),
                boxShadow: isConnected ? '0 0 8px #10b981' : (sessionState === 'connecting' ? '0 0 8px #f59e0b' : '0 0 8px #ef4444')
              }}
            ></div>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-widest hidden sm:inline-block">
               {sessionState === "disconnected" ? "System Offline" : 
                sessionState === "connecting" ? "Initializing" : "Live Session Active"}
            </span>
          </div>

          <button
            onClick={() => user ? logout() : loginWithGoogle().catch(e => {
                let msg = e.message;
                if (e.code === 'auth/unauthorized-domain') {
                    msg = "Domain not authorized! Apne Firebase Console (Authentication -> Settings -> Authorized domains) me ye domain add karein.";
                }
                setErrorMessage(msg);
            })}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-colors"
          >
            {user ? (
              <>
                <span className="w-6 h-6 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                   {user.photoURL ? <img src={user.photoURL} alt={user.displayName || "User"}/> : <LogIn className="w-4 h-4 m-1"/>}
                </span>
                <span className="hidden sm:inline-block">Log Out</span>
              </>
            ) : (
              <>
                 <LogIn className="w-4 h-4"/>
                 <span className="hidden sm:inline-block">Auth</span>
              </>
            )}
          </button>

          <div 
            onClick={() => setShowSettings(true)}
            className="w-10 h-10 rounded-full border border-slate-800 flex items-center justify-center hover:bg-slate-800 transition-colors cursor-pointer text-slate-400 hover:text-white"
          >
            <Settings className="w-5 h-5" />
          </div>
        </div>
      </header>

      {/* Main Content: Immersive Voice Interface */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-10 w-full min-h-0">
        
        {/* Status Badge - Witty Persona */}
        <AnimatePresence mode="wait">
          <motion.div 
            key={isSpeaking ? "speaking" : "listening"}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mb-8 px-6 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 backdrop-blur-md"
            style={{ 
              borderColor: `${themeColor}40`,
              backgroundColor: `${themeColor}15`
            }}
          >
            <p className="font-mono text-sm tracking-tighter" style={{ color: themeColor }}>
              {sessionState === "disconnected" ? `"Waiting for your signal."` :
               sessionState === "connecting" ? `"Waking up..."` :
               isSpeaking ? `"Listen closely."` : 
               `"Tell me something I don't know."`}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Central Core Visualizer */}
        <div className="relative flex items-center justify-center">
          {/* Outer Rings */}
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute w-72 h-72 sm:w-96 sm:h-96 border border-cyan-500/20 rounded-full border-t-cyan-500/40"
            style={{ borderColor: `${themeColor}30`, borderTopColor: `${themeColor}60` }}
          ></motion.div>
          <motion.div 
            animate={{ rotate: -360 }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            className="absolute w-80 h-80 sm:w-[450px] sm:h-[450px] border border-blue-500/10 rounded-full border-b-blue-500/30"
          ></motion.div>
          
          {/* Main Orb */}
          <motion.div 
            animate={{ 
              scale: isSpeaking ? [1, 1.05, 1] : 1,
              boxShadow: isSpeaking 
                ? [`0 0 40px -10px ${themeColor}`, `0 0 80px 10px ${themeColor}`, `0 0 40px -10px ${themeColor}`] 
                : `0 0 60px -20px ${themeColor}`
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="w-48 h-48 sm:w-64 sm:h-64 rounded-full flex items-center justify-center relative overflow-hidden border"
            style={{ 
              background: `radial-gradient(circle at top right, ${themeColor}40, #0f172a 70%)`,
              borderColor: `${themeColor}50`,
            }}
          >
            {/* Plasma Effect */}
            <div className="absolute inset-0 opacity-40">
              <motion.div 
                animate={{ 
                  x: [0, 20, -20, 0], 
                  y: [0, -20, 20, 0],
                  scale: isSpeaking ? [1, 1.2, 1] : 1
                }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute top-1/4 left-1/4 w-32 h-32 bg-white blur-[40px] rounded-full"
              ></motion.div>
              <motion.div 
                animate={{ 
                  x: [0, -30, 30, 0], 
                  y: [0, 30, -30, 0],
                  scale: isSpeaking ? [1, 1.5, 1] : 1
                }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
                className="absolute bottom-1/4 right-1/4 w-24 h-24 blur-[30px] rounded-full"
                style={{ backgroundColor: themeColor }}
              ></motion.div>
            </div>
            
            {/* Waveform Overlay */}
            {isConnected ? (
              <div className="flex items-center gap-1 sm:gap-1.5 z-10">
                {[1, 2, 3, 2, 1].map((scale, i) => (
                  <motion.div 
                    key={i}
                    animate={{ 
                      height: isSpeaking ? Math.max(16, Math.random() * 80 * scale) : (scale * 16),
                      opacity: isSpeaking ? 1 : 0.6
                    }}
                    transition={{ duration: 0.1, repeat: isSpeaking ? Infinity : 0, repeatType: "reverse" }}
                    className="w-1 bg-white/90 rounded-full"
                    style={{ 
                      height: `${scale * 24}px`,
                      boxShadow: isSpeaking && i === 2 ? `0 0 10px ${themeColor}` : 'none',
                      backgroundColor: i === 2 ? themeColor : 'rgba(255,255,255,0.9)'
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="z-10 text-white/50">
                {sessionState === "connecting" ? (
                  <Loader2 className="w-12 h-12 animate-spin" />
                ) : (
                  <MicOff className="w-12 h-12" />
                )}
              </div>
            )}
          </motion.div>

          {/* Orbital Labels (Desktop Only) */}
          <div className="hidden lg:flex absolute -right-32 top-1/4 flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
              <div className="w-8 h-px bg-slate-700"></div>
              <span>PITCH: {isSpeaking ? "42.4Hz" : "---"}</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
              <div className="w-8 h-px bg-slate-700"></div>
              <span>MOOD: WITTY</span>
            </div>
          </div>
        </div>

        {/* Real-time Interaction State */}
        <div className="mt-8 sm:mt-12 text-center z-10">
          <h2 className="text-3xl sm:text-4xl font-light tracking-widest text-white uppercase">
            {sessionState === "disconnected" ? "Offline" :
             sessionState === "connecting" ? "Initializing..." :
             isSpeaking ? "Speaking" : "Listening"}
          </h2>
          <p className="mt-2 text-slate-500 font-medium tracking-widest uppercase text-xs">
            {isConnected ? "Gemini 1.5 Flash • 24kHz Mono" : "Voice module separated"}
          </p>
          {errorMessage && (
            <div className="mt-6 px-4 py-3 bg-red-950/50 border border-red-500/30 rounded-xl backdrop-blur-md max-w-md mx-auto relative z-50 pointer-events-auto">
              <p className="text-red-400 font-medium text-sm leading-relaxed">
                <span className="font-bold uppercase tracking-wider block mb-1">Access Error</span>
                {errorMessage}
              </p>
              {(errorMessage.includes("new tab") || errorMessage.includes("denied")) && (
                <button 
                  onClick={() => window.open(window.location.href, "_blank")}
                  className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-white text-xs font-bold uppercase tracking-widest border border-red-500/50 rounded transition-colors w-full"
                >
                  Open App in New Tab
                </button>
              )}
              {errorMessage.includes("login") && (
                <button 
                  onClick={() => {
                     loginWithGoogle().then(() => setErrorMessage(null)).catch(e => {
                        let msg = e.message;
                        if (e.code === 'auth/unauthorized-domain') {
                            msg = "Domain not authorized! Apne Firebase Console (Authentication -> Settings -> Authorized domains) me ye domain add karein.";
                        }
                        setErrorMessage(msg);
                     });
                  }}
                  className="mt-3 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs font-bold uppercase tracking-widest border border-blue-500/50 rounded transition-colors flex justify-center items-center gap-2 w-full"
                >
                  <LogIn className="w-4 h-4" />
                  Login with Google
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold text-white tracking-tight">System Config</h3>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 -mr-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">
                    OpenRouter API Key
                  </label>
                  <input 
                    type="password"
                    value={openRouterKey}
                    onChange={(e) => setOpenRouterKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Saved locally. Required if using OpenRouter models.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold tracking-widest text-slate-400 uppercase mb-2">
                    Gemini API Key (Override)
                  </label>
                  <input 
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Overrides pre-configured server key for Live Voice streaming.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold tracking-widest text-slate-400 uppercase mb-3">
                    Core Color Signature
                  </label>
                  <div className="flex gap-3">
                    {[
                      { name: 'Cyan', value: '#22d3ee' },
                      { name: 'Blue', value: '#3b82f6' },
                      { name: 'Purple', value: '#a855f7' },
                      { name: 'Emerald', value: '#10b981' },
                      { name: 'Rose', value: '#f43f5e' }
                    ].map(color => (
                      <button
                        key={color.name}
                        onClick={() => setThemeColor(color.value)}
                        className={`w-8 h-8 rounded-full border-2 focus:outline-none transition-transform hover:scale-110`}
                        style={{ 
                          backgroundColor: color.value,
                          borderColor: themeColor === color.value ? 'white' : 'transparent',
                          boxShadow: themeColor === color.value ? `0 0 10px ${color.value}` : 'none'
                        }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <button 
                    onClick={() => {
                      localStorage.setItem("openRouterKey", openRouterKey);
                      localStorage.setItem("geminiKey", geminiKey);
                      localStorage.setItem("themeColor", themeColor);
                      setShowSettings(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-white text-slate-900 font-bold py-3 rounded-xl transition-colors"
                  >
                    <Save className="w-4 h-4" /> Save Configuration
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Controls Shell */}
      <footer className="px-4 sm:px-8 pb-4 sm:pb-8 z-10 w-full mb-4 sm:mb-8 shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between bg-slate-900/40 border border-white/5 backdrop-blur-xl p-4 rounded-3xl">
          
          {/* Tool Status */}
          <div className="flex w-24 sm:w-32">
            {activeTool && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col"
              >
                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-widest">Active Tool</span>
                <span className="text-xs sm:text-sm font-semibold text-slate-300 truncate">{activeTool}</span>
              </motion.div>
            )}
          </div>

          {/* Primary Action Button */}
          <button onClick={toggleConnection} className="group relative focus:outline-none">
            <div 
              className="absolute -inset-1 rounded-full blur opacity-40 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"
              style={{ background: isConnected ? 'linear-gradient(to right, #ef4444, #b91c1c)' : `linear-gradient(to right, ${themeColor}, #3b82f6)` }}
            ></div>
            <div className="relative flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-slate-950 rounded-full border border-white/20">
              {isConnected ? (
                <Square className="w-5 h-5 text-red-500 fill-red-500 rounded-sm shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
              ) : (
                <Mic className="w-6 h-6 text-white" />
              )}
            </div>
          </button>

          {/* Audio Controls & Input Level */}
          <div className="flex items-center gap-4 sm:gap-6 w-24 sm:w-32 justify-end">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-[10px] uppercase text-slate-500 font-bold tracking-widest">Input</span>
              <div className="flex gap-0.5 mt-1">
                {[1, 2, 3, 4, 5].map(i => (
                  <div 
                    key={i} 
                    className="w-1 h-3" 
                    style={{ 
                      backgroundColor: isListening && i <= 3 ? themeColor : '#334155' 
                    }}
                  ></div>
                ))}
              </div>
            </div>
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-300">
              <Headphones className="w-5 h-5" />
            </div>
          </div>
        </div>
        
        {/* Subtle hint */}
        <p className="text-center mt-6 text-[10px] uppercase tracking-[0.4em] text-slate-600 font-bold">
          {isConnected ? "System Latency: ~124ms • PCM16-16KHz Stream" : "Awaiting initialization"}
        </p>
      </footer>
    </div>
  );
}


