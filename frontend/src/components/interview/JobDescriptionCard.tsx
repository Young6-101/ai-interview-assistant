
import React from 'react';

interface JobDescriptionCardProps {
    content: string;
}

export const JobDescriptionCard: React.FC<JobDescriptionCardProps> = ({ content }) => {
    return (
        <div className="card" style={{
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Header: No Background, Tight Padding */}
            <div style={{ padding: '4px 6px', borderBottom: '1px solid #f1f5f9' }}>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#334155' }}>
                    💼 Job Description
                </h3>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '16px', color: '#475569', lineHeight: '1.6' }}>
                    {content}
                </div>
            </div>
        </div>
    );
};
