
import React from 'react';

const JD_CONTENT = `Research Assistant – HCI Lab

Requirements:
- Practical experience or strong training in user research / UX methods
- Comfortable with user study facilitation (interviews/tests/surveys)
- Prototyping skills (Figma / Adobe XD / Sketch or similar)
- Data analysis capability:
  • Qualitative: thematic analysis, coding
  • AND/OR quantitative: basic stats in Python / R / SPSS
- Solid academic/technical writing ability

Bonus:
- Prior research project or lab experience
- Familiarity with NVivo, PyTorch, Unity, participatory design
- Interest in mental health & technology, inclusive design, or AI ethics`;

export const JobDescriptionCard: React.FC = () => {
    return (
        <div className="card" style={{
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
        }}>
            {/* Header */}
            <div style={{ padding: '4px 6px', borderBottom: '1px solid #f1f5f9' }}>
                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#334155' }}>
                    💼 Job Description
                </h3>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '16px', color: '#475569', lineHeight: '1.6', textAlign: 'left' }}>
                    {JD_CONTENT}
                </div>
            </div>
        </div>
    );
};
