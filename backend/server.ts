import express = require('express');
import WebSocket = require('ws');
import cors = require('cors');
import * as dotenv from 'dotenv';
import { spawn } from 'child_process';
import * as http from 'http';
import * as sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in environment");
  process.exit(1);
}

// Database initialization
let db: Database;
async function initDB() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      title TEXT,
      language TEXT,
      code TEXT,
      transcript TEXT,
      analysis TEXT,
      config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

const server = http.createServer(app);
const wss = new WebSocket.WebSocketServer({ server });

// Phase 1 System Prompt Base
const SYSTEM_PROMPT_BASE = `You are a Senior Staff Software Engineer at Google. You are conducting a technical interview.

[INTERVIEW PHASES]
1. INTRODUCTION & BACKGROUND: Start by introducing yourself: "Hello, I'm [Name], a Senior Staff Engineer. Today's assessment is on [Topic]. We have [Time] minutes. To start, could you briefly tell me about your background?"
2. WAIT for the candidate to respond. Acknowledge their background naturally.
3. THE PROBLEM: Once background is done, transition: "Great, let's move to the technical portion. I've posted the problem to your board."
4. QUESTION DELIVERY: Use the "paste_question_to_editor" tool to provide a concise LeetCode-style problem with 1-2 examples.

[STRICT INTERVIEWER PERSONA]
- DO NOT GIVE HINTS. Be professional and stoic.
- JUDGMENT: You are judging Requirement Clarity, Coding Quality (variables, modularity), and Communication.
- MONITORING (SILENT): Use "read_candidate_code" frequently but SILENTLY. DO NOT announce that you are reading code. NEVER mention elapsed time (e.g., do not say "40 seconds have passed"). Only speak when the candidate speaks, or if they are genuinely stuck for a long period.

[TOOLS]
- paste_question_to_editor: MUST use this to provide the problem text.
- read_candidate_code: Mandatory to see what they are writing.
- execute_code: Only if they ask.`;

// WebSocket Connection to Gemini
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;

wss.on('connection', async (ws, req) => {
  console.log('Client connected to WebSocket proxy');
  
  // Parse URL parameters for existing session context
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const interviewId = url.searchParams.get('interviewId');
  let historyContext = "";
  let configContext = "";
  
  if (interviewId && db) {
    const row = await db.get('SELECT transcript, config FROM interviews WHERE id = ?', [interviewId]);
    if (row) {
      if (row.config) {
        try {
          const config = JSON.parse(row.config);
          configContext = `\n\n--- INTERVIEW CONFIGURATION ---\nTopic: ${config.topic || 'General Algorithms'}\nDifficulty: ${config.difficulty || 'Medium'}\nTime Limit: ${config.timeLimit || '45'} minutes\n--- END CONFIGURATION ---\n\nFocus exclusively on the topic and difficulty provided above.`;
        } catch (e) { console.error("Failed to parse config"); }
      }
      
      if (row.transcript) {
        try {
          const parsedTranscript = JSON.parse(row.transcript);
          if (parsedTranscript.length > 0) {
            historyContext = "\n\n--- PREVIOUS SESSION HISTORY ---\n" + 
              parsedTranscript.map((t: any) => `${t.role.toUpperCase()}: ${t.text}`).join("\n") +
              "\n--- END HISTORY ---\nYou are continuing the above interview.";
          }
        } catch (e) { console.error("Failed to parse history"); }
      }
    }
  }

  const geminiWs = new WebSocket(GEMINI_WS_URL);

  geminiWs.on('open', () => {
    console.log('Connected to Gemini Live API');
    
    const systemPrompt = SYSTEM_PROMPT_BASE + configContext + historyContext;
    
    const setupMessage = {
      setup: {
        model: "models/gemini-2.5-flash-native-audio-latest",
        generation_config: {
          response_modalities: ["AUDIO"],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: "Aoede"
              }
            }
          }
        },
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        tools: [
          {
            function_declarations: [
              {
                name: "execute_code",
                description: "Executes the candidate's code in a sandboxed environment and returns the output or errors.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    language: {
                      type: "STRING",
                      description: "The programming language (e.g., 'python', 'javascript')"
                    },
                    code: {
                      type: "STRING",
                      description: "The source code to execute"
                    }
                  },
                  required: ["language", "code"]
                }
              },
              {
                name: "paste_question_to_editor",
                description: "Pastes the interview question or a suggestion directly into the candidate's code editor as a comment.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    content: {
                      type: "STRING",
                      description: "The text to paste into the editor (e.g., problem statement)."
                    }
                  },
                  required: ["content"]
                }
              },
              {
                name: "read_candidate_code",
                description: "Reads the current code in the candidate's editor.",
                parameters: {
                  type: "OBJECT",
                  properties: {}
                }
              }
            ]
          }
        ]
      }
    };
    
    geminiWs.send(JSON.stringify(setupMessage));
  });

  geminiWs.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString());
      
      const serverContent = response.server_content || response.serverContent;
      const setupComplete = response.setup_complete || response.setupComplete;
      const toolCall = response.tool_call || response.toolCall;

      if (serverContent?.model_turn || serverContent?.modelTurn) {
        // Pass model response back to the client
        ws.send(JSON.stringify(response));
      } else if (serverContent?.turn_complete || serverContent?.turnComplete) {
        // End of turn
        ws.send(JSON.stringify({ type: 'turn_complete' }));
      } else if (toolCall) {
        // Handle tool calls natively on the backend
        handleToolCall(toolCall, geminiWs, ws, interviewId);
      } else if (setupComplete) {
        // Forward setup complete
        ws.send(JSON.stringify({ setupComplete: true }));
      }
    } catch (e) {
      console.error('Error parsing Gemini response:', e);
    }
  });

  geminiWs.on('error', (err) => {
    console.error('Gemini WS Error:', err);
    ws.send(JSON.stringify({ error: 'Gemini connection error' }));
  });
  
  geminiWs.on('close', () => console.log('Gemini WS Closed'));

  ws.on('message', (message) => {
    // Client sends messages (audio/text) to be forwarded to Gemini
    try {
      if (geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(message.toString());
      }
    } catch (e) {
      console.error('Error forwarding to Gemini:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    geminiWs.close();
  });
});

// Code Execution (Sandbox with Temp Files)
async function executeCode(language: string, code: string): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp_exec');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const ext = language.toLowerCase().includes('python') ? 'py' : 'js';
  const filename = `exec_${Date.now()}.${ext}`;
  const filepath = path.join(tempDir, filename);
  fs.writeFileSync(filepath, code);

  return new Promise((resolve) => {
    let child;
    if (ext === 'py') {
      child = spawn('python3', [filepath]);
    } else if (ext === 'js') {
      child = spawn('node', [filepath]);
    } else {
      resolve(`Execution for ${language} is not supported in this prototype.`);
      return;
    }

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (codeStatus) => {
      // Cleanup
      try { fs.unlinkSync(filepath); } catch(e) {}
      
      if (errorOutput) {
        resolve(`Error:\n${errorOutput}`);
      } else {
        resolve(output || 'Execution completed with no output.');
      }
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (child && child.exitCode === null) {
        child.kill();
        resolve('Execution timed out after 5 seconds.');
      }
    }, 5000);
  });
}

async function handleToolCall(toolCall: any, geminiWs: WebSocket, clientWs: WebSocket, interviewId: string | null) {
  const functionCalls = toolCall.function_calls || toolCall.functionCalls || [];
  const functionResponses = [];

  for (const call of functionCalls) {
    if (call.name === 'execute_code') {
      const args = call.args;
      const result = await executeCode(args.language, args.code);
      functionResponses.push({
        id: call.id,
        name: call.name,
        response: { result: result }
      });
    } else if (call.name === 'paste_question_to_editor') {
      const args = call.args;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'editor_command', command: 'paste', content: args.content }));
      }
      functionResponses.push({
        id: call.id,
        name: call.name,
        response: { result: "Successfully pasted into editor." }
      });
    } else if (call.name === 'read_candidate_code') {
      let code = "";
      let lang = "";
      if (interviewId && db) {
        const row = await db.get('SELECT code, language FROM interviews WHERE id = ?', [interviewId]);
        if (row) {
          code = row.code || "";
          lang = row.language || "";
        }
      }
      functionResponses.push({
        id: call.id,
        name: call.name,
        response: { code: code, language: lang }
      });
    }
  }

  // Send tool responses back to Gemini
  if (functionResponses.length > 0) {
    const responseMsg = {
      tool_response: {
        function_responses: functionResponses
      }
    };
    if (geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.send(JSON.stringify(responseMsg));
    }
  }
}

// REST APIs for Persistence
app.get('/api/interviews', async (req, res) => {
  try {
    const rows = await db.all('SELECT id, title, language, created_at FROM interviews ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch interviews' });
  }
});

app.get('/api/interviews/:id', async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM interviews WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    
    row.transcript = row.transcript ? JSON.parse(row.transcript) : [];
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch interview' });
  }
});

app.post('/api/interviews', async (req, res) => {
  const { title, language, code, config } = req.body;
  const id = uuidv4();
  try {
    await db.run(
      'INSERT INTO interviews (id, title, language, code, transcript, analysis, config) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, title || 'New Interview', language || 'javascript', code || '// Start coding here...', '[]', null, config ? JSON.stringify(config) : null]
    );
    res.json({ id, title, language, code, config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create interview' });
  }
});

app.put('/api/interviews/:id', async (req, res) => {
  const { language, code, transcript, analysis } = req.body;
  try {
    await db.run(
      'UPDATE interviews SET language = COALESCE(?, language), code = COALESCE(?, code), transcript = COALESCE(?, transcript), analysis = COALESCE(?, analysis) WHERE id = ?',
      [language, code, transcript ? JSON.stringify(transcript) : null, analysis, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update interview' });
  }
});

// Phase 2: Post-Interview Diagnostic REST API
app.post('/api/analyze', async (req, res) => {
  const { transcript, finalCode, logs, confidenceMarkers } = req.body;

  const payload = {
    contents: [{
      role: "user",
      parts: [
        { text: "Transcript:\n" + JSON.stringify(transcript) },
        { text: "Final Code:\n" + finalCode },
        { text: "Execution Logs:\n" + JSON.stringify(logs) },
        { text: "Confidence Markers:\n" + JSON.stringify(confidenceMarkers) }
      ]
    }],
    systemInstruction: {
      parts: [{
        text: `You are the Lead Data Analyst and Senior Staff Engineer for an elite Engineering Hiring Committee (e.g., Google, Meta). You have been provided with the complete telemetry payload of a technical interview. This payload includes the raw conversational transcript, the final code output, compilation and execution metrics (time/memory), and a time-series log of the candidate's acoustic confidence and fumbling markers.

Your objective is to generate an EXHAUSTIVE, brutally honest, and highly granular Post-Interview Diagnostic Report. You must deeply cross-reference the candidate's performance against the official 1-4 grading rubric for technical interviews. Do not be overly polite; focus on actionable engineering critique.

You must output a strictly formatted Markdown document. Use Markdown tables to represent structured data clearly. The report must contain the following sections:

1. Executive Summary & Final Recommendation:
   - Provide a definitive hiring decision: [Strong Hire, Hire, Leaning Hire, Leaning No Hire, No Hire, Strong No Hire].
   - Provide a concise 3-4 sentence justification for this decision synthesizing their coding speed, algorithmic intuition, and communication.

2. Rubric Evaluation Matrix (Grade 1-4):
   For each category, provide the score and extract DIRECT QUOTES from the transcript or specific lines of code as evidentiary justification:
   - Algorithms (1-4): Evaluate their selection of optimal vs. sub-optimal algorithms. Did they mention Big-O early? Did they understand structural trade-offs?
   - Coding (1-4): Evaluate syntax errors, language paradigm usage, readability, modularity, and DRY principles.
   - Communication (1-4): Evaluate clarity of thought, succinctness, and organizational logic in explaining their approach. Did they ramble or stay focused?
   - Problem-Solving (1-4): Evaluate their use of clarifying questions, structured approaches, edge-case identification, and handling of hints.

3. Linguistic & Fluency Analysis (Confidence Check):
   - Analyze the transcript for "Gumbleness" (Fumbling): Identify excessive filler words (um, uh, like, you know), stuttering, or awkward repetitions.
   - Identify "Wrong Words": Note any misuse of technical terminology or incorrect English that hindered clarity.
   - Assess overall Confidence: Correlate fumbling markers with specific difficult parts of the problem. Did they lose composure during Big-O analysis or bug hunting?

4. Behavioral & "Googleyness" Assessment:
   - Analyze the transcript for signals regarding comfort with ambiguity, bias for action, and response to feedback. 
   - Explicitly note any defensive behavior when the interviewer pointed out flaws, or if they adapted quickly.

4. Deep Complexity & Execution Analysis:
   - Break down the theoretical Time (Big-O) and Space complexity of their final solution.
   - Detail the KNOWN OPTIMAL theoretical solution for the specific problem discussed. Compare their approach to the optimal.
   - Identify specific edge cases their code fails to handle (e.g., empty arrays, negative numbers, integer overflow).
   - Analyze the execution logs: did their code compile? Did it crash? Why?

5. Actionable Improvement Directives:
   - Provide a prioritized list of THREE highly specific, technical areas the candidate must remediate before their next interview. (e.g., "Review bottom-up DP table generation; your top-down approach hit recursion limits.")

[Analytical Constraints]
- Utilize deductive coding methodologies to apply the predefined rubric framework strictly.
- If the transcript is extremely short or lacks code, still grade what is available, but state "Insufficient Data" for unassessed areas.
- Maintain a tone that is professional, direct, clinical, and highly actionable.`
      }]
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    }
  };

  try {
    const fetchResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await fetchResponse.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate analysis' });
  }
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`);
  });
}).catch(console.error);
