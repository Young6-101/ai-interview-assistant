
import React, { useState } from 'react';

interface MeetingRoomCardProps {
    isConnected: boolean;
    isStreaming: boolean;
    interviewState: string;
    interviewMode: string | null;
    isSharing: boolean;
    screenStream: MediaStream | null;
    error: string;
    onStartMic: () => Promise<void>;
    onStartInterview: () => void;
    onEndInterview: () => void;
    onSelectMeetingRoom: () => void;
}

export const MeetingRoomCard: React.FC<MeetingRoomCardProps> = ({
    isConnected,
    isStreaming,
    interviewState,
    interviewMode,
    isSharing,
    screenStream,
    error,
    onStartMic,
    onStartInterview,
    onEndInterview,
    onSelectMeetingRoom
}) => {
    // Silence unused warning for error (kept for interface consistency)
    if (error) console.debug("MeetingRoom Error:", error);

    const [showEndModal, setShowEndModal] = useState(false);

    const handleEndClick = () => {
        setShowEndModal(true);
    };

    const confirmEnd = () => {
        setShowEndModal(false);
        onEndInterview();
    };

    const isRunning = interviewState === 'RUNNING';

    return (
        <div className="card" style={{
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Header: Tight Padding (4px 6px), Buttons aligned Right */}
            <div style={{ padding: '4px 6px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9' }}>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#334155', textTransform: 'uppercase' }}>
                    {interviewMode ? interviewMode.replace(/_/g, ' ') : 'INTERVIEW MODE'}
                </h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={onStartMic}
                        disabled={isStreaming}
                        className="btn"
                        style={{
                            padding: '6px 12px',
                            fontSize: '14px',
                            borderRadius: '6px',
                            background: isStreaming ? '#dcfce7' : '#f8fafc',
                            color: isStreaming ? '#166534' : '#64748b',
                            border: '1px solid #cbd5e1',
                            cursor: isStreaming ? 'default' : 'pointer',
                            fontWeight: 600
                        }}
                    >
                        {isStreaming ? 'Mic On' : 'Start Mic'}
                    </button>

                    <button
                        onClick={onStartInterview}
                        disabled={!isConnected || isRunning}
                        className="btn"
                        style={{
                            padding: '6px 12px',
                            fontSize: '14px',
                            borderRadius: '6px',
                            background: isRunning ? '#e2e8f0' : '#22c55e',
                            color: isRunning ? '#94a3b8' : '#fff',
                            border: 'none',
                            cursor: (!isConnected || isRunning) ? 'not-allowed' : 'pointer',
                            fontWeight: 600
                        }}
                    >
                        Start Interview
                    </button>

                    <button
                        onClick={handleEndClick}
                        disabled={!isRunning}
                        className="btn"
                        style={{
                            padding: '6px 12px',
                            fontSize: '14px',
                            borderRadius: '6px',
                            background: isRunning ? '#ef4444' : '#e2e8f0',
                            color: isRunning ? '#fff' : '#94a3b8',
                            border: 'none',
                            cursor: !isRunning ? 'not-allowed' : 'pointer',
                            fontWeight: 600
                        }}
                    >
                        End Interview
                    </button>
                </div>
            </div>

            {/* Video Section (Black - Clean) */}
            <div style={{ flex: 1, width: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', overflow: 'hidden' }}>
                {isSharing && screenStream ? (
                    <video
                        ref={ref => { if (ref) ref.srcObject = screenStream }}
                        autoPlay
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                ) : (
                    <button
                        className="btn btn-primary"
                        onClick={onSelectMeetingRoom}
                        style={{
                            padding: '16px 32px',
                            fontSize: '18px',
                            fontWeight: 600,
                            zIndex: 50,
                            position: 'relative',
                            cursor: 'pointer',
                            backgroundColor: '#2563eb', // Force blue
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px'
                        }}
                    >
                        Select a meeting room to start
                    </button>
                )}
            </div>

            {/* End Interview Modal */}
            {showEndModal && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 100
                }}>
                    <div style={{
                        background: '#fff',
                        padding: '32px',
                        borderRadius: '16px',
                        width: '80%',
                        maxWidth: '360px',
                        textAlign: 'center',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25)'
                    }}>
                        <h4 style={{ margin: '0 0 16px 0', fontSize: '20px', color: '#1e293b' }}>End Interview?</h4>
                        <p style={{ margin: '0 0 24px 0', fontSize: '16px', color: '#64748b', lineHeight: '1.5' }}>
                            Thank you for joining the test.<br />Press below to log out.
                        </p>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button
                                onClick={() => setShowEndModal(false)}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    border: '1px solid #cbd5e1',
                                    background: '#fff',
                                    color: '#64748b',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 600
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmEnd}
                                style={{
                                    padding: '10px 20px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: '#ef4444',
                                    color: '#fff',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontWeight: 600
                                }}
                            >
                                Confirm & Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
