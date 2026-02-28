"use client";

import React, { useEffect, useState } from 'react';
import { BrainCircuit, Plus, Clock, ChevronRight, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  // Config state
  const [topic, setTopic] = useState('Data Structures & Algorithms');
  const [difficulty, setDifficulty] = useState('Medium');
  const [timeLimit, setTimeLimit] = useState('45');

  const router = useRouter();
  const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:8080';

  useEffect(() => {
    fetch(`${serverUrl}/api/interviews`)
      .then(res => res.json())
      .then(data => setInterviews(data))
      .catch(console.error);
  }, [serverUrl]);

  const createInterview = async () => {
    setIsCreating(true);
    try {
      const config = { topic, difficulty, timeLimit };
      const title = `${difficulty} ${topic} Interview`;
      
      const res = await fetch(`${serverUrl}/api/interviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, config })
      });
      const data = await res.json();
      router.push(`/interview/${data.id}`);
    } catch (err) {
      console.error(err);
      setIsCreating(false);
    }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '24px', borderBottom: '1px solid var(--border)', background: 'transparent', boxShadow: 'none' }}>
        <BrainCircuit size={36} color="var(--primary)" />
        <h1 style={{ fontSize: '1.75rem', fontWeight: 600 }}>Interview Simulator</h1>
      </header>
      
      {showConfig && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: 'var(--panel-bg)', padding: '28px', borderRadius: '16px', width: '420px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Configure Interview</h2>
              <button onClick={() => setShowConfig(false)} style={{ background: 'transparent', padding: '4px', color: '#64748b', boxShadow: 'none' }}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '28px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500, color: '#475569' }}>Topic Focus</label>
                <input 
                  type="text" 
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  style={{ width: '100%' }}
                  placeholder="e.g. Dynamic Programming, System Design"
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500, color: '#475569' }}>Difficulty</label>
                <select 
                  value={difficulty}
                  onChange={e => setDifficulty(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="Easy">Easy (L3/L4)</option>
                  <option value="Medium">Medium (L4/L5)</option>
                  <option value="Hard">Hard (L5/L6)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500, color: '#475569' }}>Time Limit (minutes)</label>
                <input 
                  type="number" 
                  value={timeLimit}
                  onChange={e => setTimeLimit(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <button onClick={createInterview} disabled={isCreating} style={{ width: '100%', padding: '12px', fontSize: '1rem', fontWeight: 600 }}>
              {isCreating ? <Loader2 className="spin" size={20} /> : 'Start Simulation'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Recent Sessions</h2>
        <button onClick={() => setShowConfig(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={16} /> New Interview
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {interviews.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', border: '2px dashed var(--border)', borderRadius: '12px', backgroundColor: 'var(--panel-bg)' }}>
            <BrainCircuit size={48} color="#cbd5e1" style={{ margin: '0 auto 12px auto' }} />
            <p style={{ fontSize: '1.1rem', fontWeight: 500 }}>No interview sessions found</p>
            <p style={{ fontSize: '0.9rem', marginTop: '4px' }}>Start a new session to begin your practice.</p>
          </div>
        ) : (
          interviews.map((interview) => (
            <div 
              key={interview.id} 
              onClick={() => router.push(`/interview/${interview.id}`)}
              className="card-list-item"
            >
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '6px', color: 'var(--foreground)' }}>{interview.title}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#64748b', fontWeight: 500 }}>
                  <Clock size={14} />
                  {new Date(interview.created_at).toLocaleString()}
                </div>
              </div>
              <ChevronRight size={24} color="#94a3b8" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}