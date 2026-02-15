import React, { createContext, useContext, useState, type ReactNode } from 'react';

// Types
export interface TranscriptSegment {
  id: string
  speaker: 'HR' | 'Candidate' | 'CANDIDATE' // Allow both cases
  text: string
  timestamp: number
  isFinal: boolean
  time?: string
}

// Alias for backward compatibility if needed, or just replace usage
export type Transcript = TranscriptSegment;

export interface WeakPoint {
  id: string;
  text: string;
  timestamp: number;
}

export interface SuggestedQuestion {
  id: string
  text: string
  skill: string
  timestamp: number
  reasoning?: string
}

export interface Topic {
  name: string;
  duration: number;
  updated?: number;
  status?: 'active' | 'completed' | 'pending';
}

export type InterviewState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'ENDED' | 'COMPLETED'

export interface InterviewContextType {
  // Core State
  interviewState: InterviewState
  setInterviewState: (state: InterviewState) => void
  transcripts: TranscriptSegment[]
  addTranscript: (segment: TranscriptSegment) => void
  suggestedQuestions: SuggestedQuestion[]
  setSuggestedQuestions: (questions: SuggestedQuestion[]) => void
  addSuggestedQuestion: (question: SuggestedQuestion) => void

  // User Session
  candidateName: string
  token: string | null
  interviewMode: string | null
  isAuthenticated: boolean
  candidateId: string
  setCandidateId: (id: string) => void

  // Legacy / Extended (needed for compatibility or unused but passed)
  updateTranscript: (id: string, updates: Partial<TranscriptSegment>) => void
  weakPoints: WeakPoint[]
  addWeakPoint: (point: WeakPoint) => void
  updateWeakPoint: (id: string, updates: Partial<WeakPoint>) => void
  clearSuggestedQuestions: () => void
  topics: Topic[]
  addTopic: (topic: Topic) => void

  // UI / Metadata Setters (Placeholders)
  setCandidateName: (name: string) => void
  setToken: (token: string) => void
  setInterviewMode: (mode: string) => void

  // Previously existed, keeping for safety if any other file uses it
  showFullscreen?: boolean
  setShowFullscreen?: (show: boolean) => void
}

const InterviewContext = createContext<InterviewContextType | undefined>(undefined);

export const InterviewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [interviewState, setInterviewState] = useState<InterviewState>('IDLE');
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);
  // User Session State
  const [candidateName, setCandidateNameState] = useState<string>(localStorage.getItem('username') || 'Candidate');
  const [token, setTokenState] = useState<string | null>(localStorage.getItem('token'));
  const [interviewMode, setInterviewModeState] = useState<string | null>(localStorage.getItem('mode') || 'realtime');
  const [candidateId, setCandidateId] = useState<string>('');

  const isAuthenticated = !!token;

  // Legacy / Placeholder state
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  const addTranscript = (t: TranscriptSegment) => {
    setTranscripts(prev => [...prev, t]);
  };

  const updateTranscript = (id: string, updates: Partial<TranscriptSegment>) => {
    setTranscripts(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }

  const addSuggestedQuestion = (q: SuggestedQuestion) => {
    setSuggestedQuestions(prev => [...prev, q]);
  };

  const clearSuggestedQuestions = () => {
    setSuggestedQuestions([]);
  }

  // Legacy Handlers
  const addWeakPoint = (wp: WeakPoint) => setWeakPoints(prev => [...prev, wp]);
  const updateWeakPoint = (id: string, updates: Partial<WeakPoint>) => setWeakPoints(prev => prev.map(wp => wp.id === id ? { ...wp, ...updates } : wp));

  const addTopic = (t: Topic) => setTopics(prev => [...prev, t]);

  const setCandidateName = (name: string) => {
    localStorage.setItem('username', name);
    setCandidateNameState(name);
  };

  const setToken = (newToken: string) => {
    localStorage.setItem('token', newToken);
    setTokenState(newToken);
  };

  const setInterviewMode = (mode: string) => {
    localStorage.setItem('mode', mode);
    setInterviewModeState(mode);
  };

  return (
    <InterviewContext.Provider value={{
      interviewState,
      setInterviewState,
      transcripts,
      addTranscript,
      suggestedQuestions,
      setSuggestedQuestions,
      addSuggestedQuestion,
      candidateName,
      token,
      interviewMode,
      isAuthenticated,
      candidateId,
      setCandidateId,

      // Legacy
      updateTranscript,
      weakPoints,
      addWeakPoint,
      updateWeakPoint,
      clearSuggestedQuestions,
      topics,
      addTopic,

      // Metadata setters
      setCandidateName,
      setToken,
      setInterviewMode
    }}>
      {children}
    </InterviewContext.Provider>
  );
};

export const useInterview = () => {
  const context = useContext(InterviewContext);
  if (!context) {
    throw new Error('useInterview must be used within an InterviewProvider');
  }
  return context;
};
