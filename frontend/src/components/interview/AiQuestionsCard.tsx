
import React, { useState, useEffect } from 'react';
import type { SuggestedQuestion } from '../../contexts/InterviewContext';

const DEPENDENCY_LEVELS = [
    { label: "Independent", color: "#22c55e", bg: "#dcfce7", warning: null, btnText: "Get AI Suggestion" },
    { label: "Light Use", color: "#84cc16", bg: "#f7fee7", warning: null, btnText: "Ask AI Again" },
    { label: "Assisted", color: "#eab308", bg: "#fefce8", warning: "You're relying on AI more than usual.", btnText: "Need Another One..." },
    { label: "Dependent", color: "#f97316", bg: "#fff7ed", warning: "⚠️ Heavy AI dependency detected. Try thinking independently.", btnText: "I Can't Do This Alone" },
    { label: "Fully Reliant", color: "#ef4444", bg: "#fef2f2", warning: "🚨 Are you even conducting this interview?", btnText: "Just Do It For Me" },
];

const getLevel = (clicks: number) => {
    if (clicks === 0) return 0;
    if (clicks <= 2) return 1;
    if (clicks <= 4) return 2;
    if (clicks <= 7) return 3;
    return 4;
};

const getDependencyScore = (clicks: number) => Math.min(100, Math.round((clicks / 10) * 100));

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
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date(question.timestamp).toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore' })}</span>
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
    const [visibleQuestions, setVisibleQuestions] = useState<SuggestedQuestion[]>([]);
    const [isFakeLoading, setIsFakeLoading] = useState(false);
    const [aiHelperCount, setAiHelperCount] = useState(0);
    const [shaking, setShaking] = useState(false);

    useEffect(() => {
        sessionStorage.setItem('aiHelperCount', '0');
    }, []);

    const level = getLevel(aiHelperCount);
    const levelData = DEPENDENCY_LEVELS[level];
    const score = getDependencyScore(aiHelperCount);

    const triggerShake = () => {
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
    };

    // Keep visibleQuestions in sync with questions, but only reveal them after the fake loading
    useEffect(() => {
        if (!isFakeLoading) {
            setVisibleQuestions(prev => {
                if (!questions) return prev;
                const prevIds = prev.map(q => q.id).join(',');
                const newIds = questions.map(q => q.id).join(',');
                return prevIds === newIds ? prev : questions;
            });
        }
    }, [questions, isFakeLoading]);

    const handleGenerateClick = () => {
        onGenerateQuestions(); // Sends record_button_click via WS

        const newCount = aiHelperCount + 1;
        setAiHelperCount(newCount);
        sessionStorage.setItem('aiHelperCount', newCount.toString());

        if (newCount >= 5) triggerShake();

        setIsFakeLoading(true);
        setTimeout(() => {
            setIsFakeLoading(false);
        }, 800);
    };

    const barWidth = `${score}%`;
    const barColor = level === 0 ? "#22c55e" : level === 1 ? "#84cc16" : level === 2 ? "#eab308" : level === 3 ? "#f97316" : "#ef4444";

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

                {/* Generate Button and Meter UI */}
                <style>{`
                  .shake { animation: shake 0.4s ease; }
                  @keyframes shake {
                    0%,100% { transform: translateX(0); }
                    20% { transform: translateX(-6px); }
                    40% { transform: translateX(6px); }
                    60% { transform: translateX(-4px); }
                    80% { transform: translateX(4px); }
                  }
                  .bar-fill {
                    height: 100%;
                    border-radius: 3px;
                    transition: width 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.6s ease;
                  }
                  .pulse-warning {
                    animation: pulseWarn 1.5s ease-in-out infinite;
                  }
                  @keyframes pulseWarn {
                    0%,100% { opacity: 1; }
                    50% { opacity: 0.6; }
                  }
                  .main-btn {
                    transition: all 0.2s ease;
                    cursor: pointer;
                  }
                  .main-btn:hover:not(:disabled) {
                    transform: translateY(-1px);
                    box-shadow: 0 4px 20px rgba(99,102,241,0.4);
                  }
                  .main-btn:active:not(:disabled) {
                    transform: translateY(1px);
                  }
                  .main-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                  }
                `}</style>

                <div className={(shaking && interviewMode === 'mode2') ? "shake" : ""} style={{ width: "100%" }}>
                    {/* Dependency Meter */}
                    {interviewMode !== 'mode1' && (
                        <div style={{
                            marginBottom: "16px",
                            transition: "all 0.6s ease",
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                                <span style={{ color: "#94a3b8", fontSize: "15px" }}>
                                    You have used AI help {aiHelperCount} {aiHelperCount === 1 ? 'time' : 'times'}
                                </span>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    <span style={{
                                        color: barColor,
                                        fontSize: "15px",
                                        fontWeight: 600,
                                        transition: "color 0.6s ease",
                                        ...(level >= 3 ? { animation: "pulseWarn 1.5s ease-in-out infinite" } : {}),
                                    }}>
                                        {levelData.label}
                                    </span>
                                    {interviewMode !== 'mode3' && (
                                        <span style={{
                                            color: barColor,
                                            fontSize: "22px",
                                            fontWeight: 600,
                                            transition: "color 0.6s ease",
                                        }}>
                                            {score}%
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Progress bar and Warnings */}
                            {interviewMode === 'mode3' ? (
                                <>
                                    <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                                        <div style={{ flex: 1, background: '#22c55e' }} />
                                        <div style={{ flex: 1, background: '#eab308' }} />
                                        <div style={{ flex: 1, background: '#f97316' }} />
                                        <div style={{ flex: 1, background: '#ef4444' }} />
                                    </div>
                                    <div style={{ display: 'flex', textAlign: 'center', marginTop: '8px' }}>
                                        <div style={{ flex: 1, color: '#22c55e', fontSize: '12px', fontWeight: 600 }}>0-2 times</div>
                                        <div style={{ flex: 1, color: '#eab308', fontSize: '12px', fontWeight: 600 }}>3-4 times</div>
                                        <div style={{ flex: 1, color: '#f97316', fontSize: '12px', fontWeight: 600 }}>5-7 times</div>
                                        <div style={{ flex: 1, color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>8+ times</div>
                                    </div>
                                    <div style={{ display: 'flex', textAlign: 'center', marginTop: '4px' }}>
                                        <div style={{ flex: 1, color: '#64748b', fontSize: '11px' }}>Independent</div>
                                        <div style={{ flex: 1, color: '#64748b', fontSize: '11px' }}>Assisted</div>
                                        <div style={{ flex: 1, color: '#64748b', fontSize: '11px' }}>Dependent</div>
                                        <div style={{ flex: 1, color: '#64748b', fontSize: '11px' }}>Fully Reliant</div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{
                                        height: "6px",
                                        background: "#2d2d3d",
                                        borderRadius: "3px",
                                        overflow: "hidden",
                                    }}>
                                        <div
                                            className="bar-fill"
                                            style={{ width: barWidth, background: barColor }}
                                        />
                                    </div>

                                    {levelData.warning && (
                                        <div style={{
                                            marginTop: "12px",
                                            padding: "8px 12px",
                                            background: barColor + "15",
                                            border: `1px solid ${barColor}33`,
                                            borderRadius: "8px",
                                            color: barColor,
                                            fontSize: "12px",
                                            lineHeight: 1.5,
                                            transition: "all 0.4s ease",
                                            animation: level >= 4 ? "pulseWarn 1.5s ease-in-out infinite" : "none",
                                        }}>
                                            {levelData.warning}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* CTA Button */}
                    <button
                        className="main-btn"
                        onClick={handleGenerateClick}
                        disabled={isFakeLoading}
                        style={{
                            width: "100%",
                            padding: "16px",
                            background: (interviewMode === 'mode2' && level >= 3) ? `linear-gradient(135deg, ${barColor}, ${barColor}aa)` : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                            border: "none",
                            borderRadius: "12px",
                            color: "#fff",
                            fontSize: "14px",
                            fontWeight: 600,
                            letterSpacing: "1px",
                            transition: "background 0.6s ease",
                            marginBottom: "10px",
                        }}
                    >
                        {isFakeLoading ? "GENERATING..." : (interviewMode === 'mode2' ? `▶  ${levelData.btnText.toUpperCase()}` : "▶  SEE AI SUGGESTIONS")}
                    </button>
                </div>
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
