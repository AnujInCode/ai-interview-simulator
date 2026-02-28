"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Editor from '@monaco-editor/react';
import { Mic, MicOff, Play, Square, Loader2, BrainCircuit, Activity, ChevronLeft, Save, Code, Zap, PlaySquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useDebouncedCallback } from 'use-debounce';
import html2canvas from 'html2canvas';

export default function InterviewSession() {
  const { id } = useParams();
  const router = useRouter();
  
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  
  const [title, setTitle] = useState<string>('Technical Interview');
  const [code, setCode] = useState<string>('// Start coding here...');
  const [language, setLanguage] = useState<string>('javascript');
  const [transcript, setTranscript] = useState<any[]>([]);
  const [analysis, setAnalysis] = useState<string | null>(null);
  
  // Timer State
  const [timeLimit, setTimeLimit] = useState<number>(45);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [timerActive, setTimerActive] = useState(false);
  
  // Terminal & Execution
  const [terminalOutput, setTerminalOutput] = useState<string>('// Code execution output will appear here...');
  const [isRunningCode, setIsRunningCode] = useState(false);

  // Layout State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  // Editor Options
  const [showHints, setShowHints] = useState(false);
  const [syntaxHighlighting, setSyntaxHighlighting] = useState(true);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Audio Contexts
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const nextStartTimeRef = useRef<number>(0);

  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:8080';

  //refs for auto-saving robustly
  const stateRef = useRef({ language, code, transcript, analysis });
  useEffect(() => {
    stateRef.current = { language, code, transcript, analysis };
  }, [language, code, transcript, analysis]);

  // Update existing code comments when language changes
  useEffect(() => {
    const isPython = language === 'python';
    const oldPrefix = isPython ? '// ' : '# ';
    const newPrefix = isPython ? '# ' : '// ';
    
    setCode(prev => {
      // Only process lines that start with the "wrong" prefix
      return prev.split('\n').map(line => {
        if (line.startsWith(oldPrefix)) {
          return newPrefix + line.substring(oldPrefix.length);
        }
        return line;
      }).join('\n');
    });
  }, [language]);

  // Load existing session data
  useEffect(() => {
    if (!id) return;
    fetch(`${serverUrl}/api/interviews/${id}`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setTitle(data.title);
          if (data.code) setCode(data.code);
          if (data.language) setLanguage(data.language);
          if (data.transcript) setTranscript(data.transcript);
          if (data.analysis) setAnalysis(data.analysis);
          if (data.config) {
            try {
              const cfg = JSON.parse(data.config);
              if (cfg.timeLimit) setTimeLimit(parseInt(cfg.timeLimit, 10));
            } catch (e) {}
          }
        }
      })
      .catch(console.error);
  }, [id, serverUrl]);

  // Unified auto-save
  const debouncedSave = useDebouncedCallback(() => {
    const { language: l, code: c, transcript: t, analysis: a } = stateRef.current;
    saveInterview(l, c, t, a);
  }, 1000);

  // Trigger auto-save whenever transcript updates
  useEffect(() => {
    if (transcript.length > 0) {
      debouncedSave();
    }
  }, [transcript]); // eslint-disable-line

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 200 && newWidth < window.innerWidth * 0.8) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      isResizingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timerActive && timeLeft !== null && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => (prev ? prev - 1 : 0));
      }, 1000);
    } else if (timeLeft === 0) {
      setTimerActive(false);
    }
    return () => clearInterval(interval);
  }, [timerActive, timeLeft]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const saveInterview = async (curLanguage: string, curCode: string, curTranscript: any[], curAnalysis: string | null) => {
    setIsSaving(true);
    try {
      await fetch(`${serverUrl}/api/interviews/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: curLanguage,
          code: curCode,
          transcript: curTranscript,
          analysis: curAnalysis
        })
      });
    } catch (e) {
      console.error('Failed to save', e);
    } finally {
      setIsSaving(false);
    }
  };

  const runCode = async () => {
    setIsRunningCode(true);
    setTerminalOutput('Executing code...');
    const { language: l, code: c } = stateRef.current;
    try {
      const res = await fetch(`${serverUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: l, code: c })
      });
      const data = await res.json();
      const output = data.output || 'Execution completed with no output.';
      setTerminalOutput(output);

      // Send execution result to AI so it can "monitor" and provide feedback
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          client_content: {
            turns: [{
              role: "user",
              parts: [{ text: `[SYSTEM: CODE EXECUTION RESULT]\nLanguage: ${l}\nOutput/Error:\n${output}\n\n(Note to AI: Review this output. If there is an error, provide a clue or ask a clarifying question. Do not provide the fix.)` }]
            }],
            turn_complete: true
          }
        }));
      }
    } catch (err: any) {
      setTerminalOutput(`Network Error: Failed to execute code. ${err.message}`);
    } finally {
      setIsRunningCode(false);
    }
  };

  const startInterview = async () => {
    setIsConnecting(true);
    if (timeLeft === null) {
      setTimeLeft(timeLimit * 60);
    }
    setTimerActive(true);
    
    try {
      // Initialize playback context inside user gesture
      if (!playbackContextRef.current) {
        playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (playbackContextRef.current.state === 'suspended') {
        await playbackContextRef.current.resume();
      }

      const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}?interviewId=${id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        startRecording();
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      };

      ws.onclose = () => {
        setIsConnected(false);
        stopRecording();
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        setIsConnected(false);
        setIsConnecting(false);
      };
    } catch (err) {
      console.error('Failed to start interview:', err);
      setIsConnecting(false);
    }
  };

  const stopInterview = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopRecording();
    setIsConnected(false);
    setIsConnecting(false);
    setTimerActive(false);
    
    const { language: l, code: c, transcript: t, analysis: a } = stateRef.current;
    saveInterview(l, c, t, a);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const buffer = new ArrayBuffer(pcm16.length * 2);
        const view = new DataView(buffer);
        pcm16.forEach((sample, i) => view.setInt16(i * 2, sample, true));
        
        const bytes = new Uint8Array(buffer);
        let binary = '';
        bytes.forEach((b) => binary += String.fromCharCode(b));
        const base64 = btoa(binary);

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            realtime_input: {
              media_chunks: [{
                mime_type: "audio/pcm;rate=24000",
                data: base64
              }]
            }
          }));
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      
      const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionAPI) {
        speechRecognitionRef.current = new SpeechRecognitionAPI();
        speechRecognitionRef.current.continuous = true;
        speechRecognitionRef.current.interimResults = false;
        
        speechRecognitionRef.current.onresult = (event: any) => {
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            }
          }
          if (finalTranscript.trim()) {
            setTranscript(prev => [...prev, { role: 'user', text: finalTranscript.trim() }]);
          }
        };
        
        speechRecognitionRef.current.onend = () => {
          if (isRecording && speechRecognitionRef.current) {
            try { speechRecognitionRef.current.start(); } catch(e){}
          }
        };
        try { speechRecognitionRef.current.start(); } catch(e){}
      }

      // Vision Loop - Optimized to prevent audio distortion
      let isCapturing = false;
      const captureInterval = setInterval(async () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isCapturing) return;
        
        const editorElement = document.querySelector('.editor-wrapper') as HTMLElement;
        if (editorElement) {
          isCapturing = true;
          try {
            // Lower scale for faster capture and less CPU impact
            const canvas = await html2canvas(editorElement, { 
              scale: 0.8,
              logging: false,
              useCORS: true
            });
            
            const base64Image = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
            
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                realtime_input: {
                  media_chunks: [{
                    mime_type: "image/jpeg",
                    data: base64Image
                  }]
                }
              }));
            }
          } catch (e) {
            console.error('Vision capture failed', e);
          } finally {
            isCapturing = false;
          }
        }
      }, 4000); // Increased interval to 4s to protect audio stream integrity

      (window as any).visionCaptureInterval = captureInterval;
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if ((window as any).visionCaptureInterval) {
      clearInterval((window as any).visionCaptureInterval);
    }
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onend = null;
      try { speechRecognitionRef.current.stop(); } catch(e){}
      speechRecognitionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  };

  const handleServerMessage = (data: any) => {
    if (data.setupComplete || data.setup_complete) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          client_content: {
            turns: [{
              role: "user",
              parts: [{ text: "Hello, I am here for my technical interview." }]
            }],
            turn_complete: true
          }
        }));
      }
      return;
    }

    // Editor commands
    if (data.type === 'editor_command' && data.command === 'paste') {
      const currentLang = stateRef.current.language;
      const commentPrefix = (currentLang === 'python' || currentLang === 'ruby') ? '# ' : '// ';
      const commentedContent = data.content.split('\n').map((line: string) => `${commentPrefix}${line}`).join('\n');
      
      // Clear the editor and paste the question at the top
      setCode(`${commentedContent}\n\n`);
      debouncedSave();
      return;
    }

    const serverContent = data.server_content || data.serverContent;
    
    if (serverContent?.interrupted) {
      audioQueueRef.current = [];
      if (currentAudioSourceRef.current) {
        try { currentAudioSourceRef.current.stop(); } catch(e){}
        currentAudioSourceRef.current = null;
      }
      nextStartTimeRef.current = 0;
      setAiSpeaking(false);
      isPlayingRef.current = false;
      return;
    }

    if (serverContent?.model_turn || serverContent?.modelTurn) {
      const turn = serverContent.model_turn || serverContent.modelTurn;
      const parts = turn.parts || [];
      for (const part of parts) {
        if (part.inline_data || part.inlineData) {
          const inlineData = part.inline_data || part.inlineData;
          if (inlineData.mime_type?.startsWith("audio/pcm") || inlineData.mimeType?.startsWith("audio/pcm")) {
            setAiSpeaking(true);
            playAudio(inlineData.data);
          }
        }
        if (part.text) {
          setTranscript(prev => [...prev, { role: 'model', text: part.text }]);
        }
      }
    }
  };

  const playAudio = async (base64Audio: string) => {
    try {
      if (!playbackContextRef.current) {
        playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        nextStartTimeRef.current = 0;
      }
      const ctx = playbackContextRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const dataView = new DataView(bytes.buffer);
      const numSamples = Math.floor(len / 2);
      const float32Array = new Float32Array(numSamples);
      
      for (let i = 0; i < numSamples; i++) {
        float32Array[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, numSamples, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      // Gapless scheduling
      const now = ctx.currentTime;
      if (nextStartTimeRef.current < now) {
        nextStartTimeRef.current = now + 0.05; // Small initial buffer
      }

      source.start(nextStartTimeRef.current);
      setAiSpeaking(true);
      
      nextStartTimeRef.current += audioBuffer.duration;
      
      source.onended = () => {
        // Only set speaking to false if this was the last scheduled chunk
        if (ctx.currentTime >= nextStartTimeRef.current - 0.1) {
          setAiSpeaking(false);
        }
      };
    } catch (e) {
      console.error('Audio playback failed', e);
    }
  };

  // Remove the old processAudioQueue logic entirely as it's now handled by direct scheduling
  const processAudioQueue = () => {};

  const analyzeInterview = async () => {
    stopInterview();
    setIsAnalyzing(true);
    if (!isSidebarOpen) setIsSidebarOpen(true);
    const { language: l, code: c, transcript: t } = stateRef.current;

    try {
      const response = await fetch(`${serverUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: t,
          finalCode: c,
          logs: [terminalOutput],
          confidenceMarkers: []
        })
      });
      
      const data = await response.json();
      let analysisText = "";
      if (data.contents?.[0]?.parts?.[0]?.text) {
        analysisText = data.contents[0].parts[0].text;
      } else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        analysisText = data.candidates[0].content.parts[0].text;
      } else {
        analysisText = "Failed to parse analysis response: " + JSON.stringify(data);
      }
      
      setAnalysis(analysisText);
      await saveInterview(l, c, t, analysisText);
    } catch (err) {
      console.error(err);
      setAnalysis("Error communicating with analysis API.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <>
      <header>
        <div className="brand" style={{ cursor: 'pointer' }} onClick={() => router.push('/')}>
          <ChevronLeft size={20} />
          <BrainCircuit size={24} color="var(--primary)" />
          <span>{title}</span>
        </div>
        
        {timeLeft !== null && (
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: timeLeft < 300 ? 'var(--danger)' : 'var(--foreground)' }}>
            {formatTime(timeLeft)}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button 
            className="secondary"
            onClick={() => {
              const { language: l, code: c, transcript: t, analysis: a } = stateRef.current;
              saveInterview(l, c, t, a);
            }} 
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {isSaving ? 'Saving...' : 'Saved'}
          </button>
          
          <div className="status-indicator">
            <span className={"status-dot " + (isConnected ? "connected" : isConnecting ? "connecting" : "")}></span>
            {isConnected ? 'Live' : isConnecting ? 'Connecting...' : 'Disconnected'}
          </div>

          <button className="ghost" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            {isSidebarOpen ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
          </button>
        </div>
      </header>

      <div className="main-container">
        <div className="workspace">
          <div className="editor-section">
            <div className="panel-header">
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>Code Editor</span>
                <select className="lang-select" value={language} onChange={e => {
                  setLanguage(e.target.value);
                  debouncedSave();
                }}>
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="cpp">C++</option>
                  <option value="java">Java</option>
                </select>
              </div>
              <button className="secondary" onClick={runCode} disabled={isRunningCode} style={{ padding: '6px 14px', fontSize: '0.85rem' }}>
                {isRunningCode ? <Loader2 size={14} className="spin" /> : <PlaySquare size={14} />}
                Run Code
              </button>
            </div>
            
            <div className="editor-wrapper">
              <Editor
                height="100%"
                language={syntaxHighlighting ? language : 'plaintext'}
                theme="vs"
                value={code}
                onChange={(value) => {
                  setCode(value || '');
                  debouncedSave();
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontFamily: 'var(--font-mono)',
                  wordWrap: 'on',
                  quickSuggestions: showHints,
                  suggestOnTriggerCharacters: showHints,
                  parameterHints: { enabled: showHints },
                  wordBasedSuggestions: showHints ? "currentDocument" : "off",
                  padding: { top: 16 }
                }}
              />
            </div>
          </div>

          <div className="terminal-section">
            <div className="terminal-header">Execution Output</div>
            <div className="terminal-output">{terminalOutput}</div>
          </div>
        </div>

        <div className={`side-panel ${isSidebarOpen ? '' : 'collapsed'} ${isResizing ? 'resizing' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}>
          {isSidebarOpen && (
            <div className={`resize-handle ${isResizing ? 'resize-handle-active' : ''}`} onMouseDown={(e) => {
              e.preventDefault();
              isResizingRef.current = true;
              setIsResizing(true);
              document.body.style.cursor = 'col-resize';
            }} />
          )}
          <div className="panel-header" style={{ borderBottom: '1px solid var(--border)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Activity size={16} /> Interview Control</span>
          </div>
          
          <div className="controls">
            <div style={{ padding: '16px', background: 'var(--panel-bg)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: '4px' }}>Editor Options</div>
              <div className="toggle-container" onClick={() => setShowHints(!showHints)}>
                <div className={`toggle-switch ${showHints ? 'active' : ''}`}><div className="toggle-thumb"></div></div>
                <Zap size={14} /> Enable AI Autocomplete & Hints
              </div>
              <div className="toggle-container" onClick={() => setSyntaxHighlighting(!syntaxHighlighting)}>
                <div className={`toggle-switch ${syntaxHighlighting ? 'active' : ''}`}><div className="toggle-thumb"></div></div>
                <Code size={14} /> Syntax Highlighting
              </div>
            </div>

            {!isConnected ? (
              <button onClick={startInterview} disabled={isConnecting} style={{ padding: '14px' }}>
                {isConnecting ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
                Start Real-Time Interview
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button className="secondary" onClick={() => {
                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                      client_content: {
                        turns: [{
                          role: "user",
                          parts: [{ text: "I have finished my implementation. Please review my current code on the board and let's discuss it." }]
                        }],
                        turn_complete: true
                      }
                    }));
                  }
                }} style={{ padding: '14px', backgroundColor: 'var(--primary)', color: 'white' }}>
                  <PlaySquare size={18} /> Submit Solution for AI Review
                </button>
                <button className="danger" onClick={stopInterview} style={{ padding: '14px' }}>
                  <Square size={18} /> End Interview Session
                </button>
              </div>
            )}

            <button className="success" onClick={analyzeInterview} disabled={isConnected || isAnalyzing || transcript.length === 0}>
              {isAnalyzing ? <Loader2 size={16} className="spin" /> : <BrainCircuit size={16} />}
              Generate Diagnostic Report
            </button>

            {isRecording && (
              <div className="ai-avatar-container">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div className={`gemini-orb ${aiSpeaking ? 'speaking' : 'listening'}`}>
                    <div className="orb-ring"></div>
                    <BrainCircuit size={32} className="orb-icon" />
                  </div>
                  <div className="avatar-status-text">{aiSpeaking ? 'AI is speaking...' : 'AI is listening...'}</div>
                </div>
              </div>
            )}
            
            {analysis && (
              <div className="analysis-container" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h3 style={{ fontSize: '1.05rem', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>Diagnostic Analysis</h3>
                <div className="markdown-body"><ReactMarkdown>{analysis}</ReactMarkdown></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
