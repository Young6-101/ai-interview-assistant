import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type InterviewState = 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'ENDED';

export interface Transcript {
  id: string;
  speaker: 'HR' | 'CANDIDATE';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface WeakPoint {
  id: string;
  category: string;
  description: string;
  details?: string;
  timestamp: number;
}

export interface SuggestedQuestion {
  id: string;
  text: string;
  skill: string;
  timestamp: number;
}

export interface Topic {
  id: string;
  name: string;
  timestamp: number;
  updated?: number;
}

interface InterviewContextType {
  // Interview Control
  interviewState: InterviewState;
  setInterviewState: (state: InterviewState) => void;
  
  // Data
  transcripts: Transcript[];
  addTranscript: (transcript: Transcript) => void;
  updateTranscript: (id: string, updates: Partial<Transcript>) => void;
  
  weakPoints: WeakPoint[];
  addWeakPoint: (point: WeakPoint) => void;
  updateWeakPoint: (id: string, updates: Partial<WeakPoint>) => void;
  
  suggestedQuestions: SuggestedQuestion[];
  addSuggestedQuestion: (question: SuggestedQuestion) => void;
  
  topics: Topic[];
  addTopic: (topic: Topic) => void;
  updateTopic: (id: string, updates: Partial<Topic>) => void;
  
  // WebSocket Status
  isWebSocketConnected: boolean;
  setWebSocketConnected: (connected: boolean) => void;
  
  // Audio Status
  isHrMicConnected: boolean;
  setHrMicConnected: (connected: boolean) => void;
  isCandidateMicConnected: boolean;
  setCandidateMicConnected: (connected: boolean) => void;
  
  // Meeting Room Status
  isMeetingRoomConnected: boolean;
  setMeetingRoomConnected: (connected: boolean) => void;
  
  // UI state
  showFullscreen: boolean;
  setShowFullscreen: (show: boolean) => void;
}

const InterviewContext = createContext<InterviewContextType | undefined>(undefined);

export const InterviewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [interviewState, setInterviewState] = useState<InterviewState>('NOT_STARTED');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isWebSocketConnected, setWebSocketConnected] = useState(false);
  const [isHrMicConnected, setHrMicConnected] = useState(false);
  const [isCandidateMicConnected, setCandidateMicConnected] = useState(false);
  const [isMeetingRoomConnected, setMeetingRoomConnected] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);

  const addTranscript = useCallback((transcript: Transcript) => {
    setTranscripts((prev) => [...prev, transcript]);
  }, []);

  const updateTranscript = useCallback((id: string, updates: Partial<Transcript>) => {
    setTranscripts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const addWeakPoint = useCallback((point: WeakPoint) => {
    setWeakPoints((prev) => [...prev, point]);
  }, []);

  const updateWeakPoint = useCallback((id: string, updates: Partial<WeakPoint>) => {
    setWeakPoints((prev) =>
      prev.map((wp) => (wp.id === id ? { ...wp, ...updates } : wp))
    );
  }, []);

  const addSuggestedQuestion = useCallback((question: SuggestedQuestion) => {
    setSuggestedQuestions((prev) => [...prev, question]);
  }, []);

  const addTopic = useCallback((topic: Topic) => {
    setTopics((prev) => [...prev, topic]);
  }, []);

  const updateTopic = useCallback((id: string, updates: Partial<Topic>) => {
    setTopics((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const value: InterviewContextType = {
    interviewState,
    setInterviewState,
    transcripts,
    addTranscript,
    updateTranscript,
    weakPoints,
    addWeakPoint,
    updateWeakPoint,
    suggestedQuestions,
    addSuggestedQuestion,
    topics,
    addTopic,
    updateTopic,
    isWebSocketConnected,
    setWebSocketConnected,
    isHrMicConnected,
    setHrMicConnected,
    isCandidateMicConnected,
    setCandidateMicConnected,
    isMeetingRoomConnected,
    setMeetingRoomConnected,
    showFullscreen,
    setShowFullscreen,
  };

  return (
    <InterviewContext.Provider value={value}>
      {children}
    </InterviewContext.Provider>
  );
};

export const useInterview = () => {
  const context = useContext(InterviewContext);
  if (context === undefined) {
    throw new Error('useInterview must be used within InterviewProvider');
  }
  return context;
};
