
import React, { useState, useEffect } from 'react';
import type { SuggestedQuestion } from '../../contexts/InterviewContext';

interface AiQuestionsCardProps {
    questions: SuggestedQuestion[];
    interviewMode: string | null;
    onGenerateQuestions: () => void;
}

const TYPE_CONFIG: Record<string, { color: string; label: string; emoji: string; bg: string }> = {
    follow_up: { color: '#3b82f6', label: 'FOLLOW-UP', emoji: '🔽', bg: '#eff6ff' },
    move_on: { color: '#f59e0b', label: 'MOVE-ON', emoji: '➡️', bg: '#fffbeb' },
    revert: { color: '#8b5cf6', label: 'REVERT', emoji: '🔙', bg: '#f5f3ff' },
};

const SuggestedQuestionItem: React.FC<{ question: SuggestedQuestion }> = ({ question }) => {
    const [expanded, setExpanded] = useState(false);
    const config = TYPE_CONFIG[question.type || ''] || { color: '#3b82f6', label: question.skill || 'GENERAL', emoji: '❓', bg: '#fff' };

    return (
        <div
            className="suggestion-item"
            onClick={() => setExpanded(!expanded)}
            style={{
                marginBottom: '10px',
                padding: '12px',
                background: config.bg,
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                borderLeft: `4px solid ${config.color}`
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: config.color,
                    textTransform: 'uppercase',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: `${config.color}15`,
                }}>
                    {config.emoji} {config.label}
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date(question.timestamp).toLocaleTimeString()}</span>
            </div>

            <p style={{ margin: '4px 0', fontSize: '15px', fontWeight: 500, color: '#1e293b', lineHeight: '1.4' }}>
                {question.text}
            </p>

            {expanded && question.reasoning && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <p style={{ fontSize: '13px', color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                        💡 {question.reasoning}
                    </p>
                </div>
            )}
        </div>
    )
}

export const AiQuestionsCard: React.FC<AiQuestionsCardProps> = ({ questions, interviewMode, onGenerateQuestions }) => {
    const [showWarning, setShowWarning] = useState(false);
    const [visibleQuestions, setVisibleQuestions] = useState<SuggestedQuestion[]>([]);
    const [hasNew, setHasNew] = useState(false);
    const [isFakeLoading, setIsFakeLoading] = useState(false);

    useEffect(() => {
        if (questions && questions.length > 0) {
            const visibleIds = visibleQuestions.map(q => q.id).join(',');
            const currentIds = questions.map(q => q.id).join(',');
            if (visibleIds !== currentIds) {
                setHasNew(true);
            }
        }
    }, [questions, visibleQuestions]);

    const handleGenerateClick = () => {
        onGenerateQuestions(); // Sends record_button_click via WS

        setIsFakeLoading(true);
        setTimeout(() => {
            if (hasNew) {
                setVisibleQuestions(questions);
                setHasNew(false);
            }
            setIsFakeLoading(false);
        }, 800);

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
                        background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '16px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        marginBottom: isWarningVisible() ? '16px' : '0',
                        transition: 'box-shadow 0.2s ease, transform 0.15s ease',
                        letterSpacing: '0.02em',
                    }}
                    onMouseOver={(e) => {
                        e.currentTarget.style.boxShadow = '0 4px 20px rgba(124, 58, 237, 0.55)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.boxShadow = 'none';
                        e.currentTarget.style.transform = 'translateY(0)';
                    }}
                >
                    {isFakeLoading ? '⏳ Generating...' : '✨ Generate Questions'}
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

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', background: '#f8fafc' }}>
                {visibleQuestions.length === 0 ? (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '15px' }}>
                        Waiting for conversation...
                    </div>
                ) : (
                    visibleQuestions.map(q => (
                        <SuggestedQuestionItem key={q.id} question={q} />
                    ))
                )}
            </div>
        </div>
    );
};
