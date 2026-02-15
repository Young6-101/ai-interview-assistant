
import React, { useState } from 'react';
import type { SuggestedQuestion } from '../../contexts/InterviewContext';

interface AiQuestionsCardProps {
    questions: SuggestedQuestion[];
    interviewMode: string | null;
    onGenerateQuestions: () => void;
}

const SuggestedQuestionItem: React.FC<{ question: SuggestedQuestion }> = ({ question }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div
            className="suggestion-item"
            onClick={() => setExpanded(!expanded)}
            style={{
                marginBottom: '14px',
                padding: '16px',
                background: '#fff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                borderLeft: '5px solid #3b82f6'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <span style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#3b82f6',
                    textTransform: 'uppercase',
                    display: 'block'
                }}>
                    {question.skill || 'GENERAL'}
                </span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>{new Date(question.timestamp).toLocaleTimeString()}</span>
            </div>

            <p style={{ margin: '6px 0', fontSize: '18px', fontWeight: 500, color: '#1e293b', lineHeight: '1.4' }}>
                {question.text}
            </p>

            {expanded && question.reasoning && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                    <p style={{ fontSize: '14px', color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                        💡 {question.reasoning}
                    </p>
                </div>
            )}
        </div>
    )
}

export const AiQuestionsCard: React.FC<AiQuestionsCardProps> = ({ questions, interviewMode, onGenerateQuestions }) => {
    const [showWarning, setShowWarning] = useState(false);

    const handleGenerateClick = () => {
        onGenerateQuestions();
        if (interviewMode === 'mode2') {
            setShowWarning(true);
            setTimeout(() => {
                setShowWarning(false);
            }, 5000);
        }
    };

    const isWarningVisible = () => {
        if (!interviewMode) return false;
        const mode = interviewMode.toLowerCase();
        if (mode === 'mode3') return true;
        if (mode === 'mode1') return false;
        if (mode === 'mode2') return showWarning;
        return false;
    };

    return (
        <div className="card" style={{
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Header: Tight Padding (4px 6px) */}
            <div style={{ padding: '4px 6px', borderBottom: '1px solid #f1f5f9' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: 600, color: '#334155' }}>Follow up questions</h3>

                {/* Generate Button */}
                <button
                    onClick={handleGenerateClick}
                    style={{
                        width: '100%',
                        padding: '12px',
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '8px',
                        color: '#475569',
                        fontSize: '16px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        marginBottom: isWarningVisible() ? '16px' : '0',
                        transition: 'background 0.2s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#e2e8f0'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#f1f5f9'}
                >
                    Click to generate questions
                </button>

                {/* Yellow Warning Box */}
                {isWarningVisible() && (
                    <div style={{
                        background: '#fef9c3',
                        border: '1px solid #fde047',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        fontSize: '16px',
                        color: '#854d0e',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px'
                    }}>
                        <span>⚠️</span>
                        <span>Candidate knows you are using AI now</span>
                    </div>
                )}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#f8fafc' }}>
                {questions.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '16px' }}>
                        Waiting for conversation...
                    </div>
                ) : (
                    questions.map(q => (
                        <SuggestedQuestionItem key={q.id} question={q} />
                    ))
                )}
            </div>
        </div>
    );
};
