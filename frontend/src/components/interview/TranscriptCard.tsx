
import React, { useRef, useEffect } from 'react';
import type { TranscriptSegment } from '../../contexts/InterviewContext';

interface TranscriptCardProps {
    transcripts: TranscriptSegment[];
}

export const TranscriptCard: React.FC<TranscriptCardProps> = ({ transcripts }) => {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcripts]);

    return (
        <div className="card" style={{
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Header: Tight Padding */}
            <div style={{ padding: '4px 6px', borderBottom: '1px solid #f1f5f9' }}>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#334155' }}>
                    📝 Live Transcript
                </h3>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', fontSize: '18px', lineHeight: '1.6' }}>
                {transcripts.length === 0 && <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '16px' }}>Transcripts will appear here...</p>}
                {transcripts.map(t => (
                    <div key={t.id} style={{ marginBottom: '14px' }}>
                        <span style={{
                            fontWeight: 700,
                            color: t.speaker === 'HR' ? '#2563eb' : '#059669',
                            marginRight: '12px',
                            fontSize: '14px',
                            textTransform: 'uppercase'
                        }}>
                            {t.speaker === 'HR' ? 'You' : 'Candidate'}
                        </span>
                        <span style={{ color: '#334155' }}>{t.text}</span>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
};
