"""
OpenAI Realtime API Integration for Interview Analysis
Async utility methods for question classification and weak points analysis
"""

import os
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


class RealtimeAnalyzer:
    """OpenAI API wrapper for interview analysis (REST API pattern)"""

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the analyzer

        Args:
            api_key: OpenAI API key (defaults to OPENAI_API_KEY env var)
        """
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            logger.error("❌ OPENAI_API_KEY not found!")
        else:
            logger.info(f"✅ OpenAI API Key loaded: {self.api_key[:20]}...")
        self.client = AsyncOpenAI(api_key=self.api_key)

    async def classify_question(self, text: str) -> Dict:
        """
        Classify HR question type

        Args:
            text: The question text to classify

        Returns:
            Dictionary with classification results
        """
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": """You are an HR interview question classifier. Analyze the given statement and determine:
1. Is it a question (requires an answer)?
2. If yes, what type?

Question types:
- background_question: Background, resume, education questions
- behavioral_question: Past experiences and specific situations
- situational_question: Hypothetical scenarios
- knowledge_question: Technical knowledge or system design
- general_question: General questions (strengths, weaknesses, motivation, etc.)
- probe_question: Follow-up questions probing deeper

Response as JSON:
{"is_question": bool, "question_type": "type_name", "confidence": "high|medium|low"}"""
                    },
                    {"role": "user", "content": f"Classify this HR statement:\n\n{text}"}
                ],
                temperature=0.3,
            )

            result_text = response.choices[0].message.content
            # Parse JSON from response
            result = json.loads(result_text)
            result["text"] = text
            return result

        except json.JSONDecodeError:
            logger.warning(f"Failed to parse classification response, returning default")
            return {
                "is_question": True,
                "question_type": "general_question",
                "confidence": "low",
                "text": text
            }
        except Exception as e:
            logger.error(f"Error classifying question: {e}")
            return {
                "is_question": True,
                "question_type": "general_question",
                "confidence": "low",
                "text": text
            }

    async def analyze_answer(self, question: str, answer: str, framework: str = "star") -> Dict:
        """
        Analyze candidate's answer quality

        Args:
            question: The HR question asked
            answer: Candidate's answer
            framework: Analysis framework (star/technical/general)

        Returns:
            Dictionary with analysis results
        """
        try:
            framework_instructions = self._get_framework_instructions(framework)

            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": f"""You are an expert interview analyst. Analyze the candidate's response using the {framework.upper()} framework.

{framework_instructions}

Provide a quality score (0-100) and identify 2-3 weak points.

Response as JSON:
{{
  "quality_score": number,
  "strengths": [list of 2-3 strengths],
  "weak_points": [
    {{"component": "name", "severity": "high|medium|low", "question": "follow-up question"}}
  ],
  "suggestions": [list of 2-3 suggestions]
}}"""
                    },
                    {
                        "role": "user",
                        "content": f"""Q: {question}

A: {answer}

Analyze using {framework.upper()} framework."""
                    }
                ],
                temperature=0.5,
            )

            result_text = response.choices[0].message.content
            result = json.loads(result_text)
            return result

        except json.JSONDecodeError:
            logger.warning(f"Failed to parse analysis response, returning placeholder")
            return {
                "quality_score": 50,
                "strengths": ["Provided answer", "Attempted to address question"],
                "weak_points": [
                    {"component": "Clarity", "severity": "medium", "question": "Can you elaborate more?"}
                ],
                "suggestions": ["Provide more specific examples", "Add measurable outcomes"]
            }
        except Exception as e:
            logger.error(f"Error analyzing answer: {e}")
            return {
                "quality_score": 0,
                "strengths": [],
                "weak_points": [],
                "suggestions": ["Unable to analyze at this time"]
            }

    async def generate_followup_questions(self, context: str, weak_area: str, count: int = 3) -> List[str]:
        """
        Generate follow-up questions based on weak points

        Args:
            context: Interview context (what's been asked/answered so far)
            weak_area: Description of the weak area
            count: Number of questions to generate (default 3)

        Returns:
            List of follow-up question suggestions
        """
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": f"""You are an experienced HR interviewer conducting a behavioral interview. 
Generate {count} insightful follow-up questions that dig deeper into the candidate's weak areas.

Questions should be:
- Open-ended and conversational
- Specific to the actual content of the interview (use names, projects, details mentioned)
- Designed to elicit concrete examples and measurable results
- Professional and respectful
- Varied in focus (don't ask the same question three times)

IMPORTANT: Respond with ONLY a JSON array of strings, nothing else:
["question1", "question2", "question3"]"""
                    },
                    {
                        "role": "user",
                        "content": f"""Based on this interview exchange:

{context}

The main area that needs more depth: {weak_area}

Generate {count} specific, varied follow-up questions that will help the candidate provide more detail."""
                    }
                ],
                temperature=0.8,
            )

            result_text = response.choices[0].message.content.strip()
            
            # Try to extract JSON if there's extra text
            if not result_text.startswith('['):
                start = result_text.find('[')
                end = result_text.rfind(']') + 1
                if start >= 0 and end > start:
                    result_text = result_text[start:end]
            
            questions = json.loads(result_text)
            return questions if isinstance(questions, list) else [questions]

        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse questions response: {e}, returning defaults")
            return [
                f"Can you tell me more about {weak_area}?",
                f"What challenges did you face with {weak_area}?",
                f"How would you approach {weak_area} differently next time?"
            ]
        except Exception as e:
            logger.error(f"Error generating followup questions: {e}")
            return []

    def _get_framework_instructions(self, framework: str) -> str:
        """Get framework-specific evaluation instructions"""
        frameworks = {
            "star": """
STAR Framework (Situation, Task, Action, Result):
- Situation: Context and background of the scenario
- Task: Specific responsibility or challenge
- Action: Concrete steps the candidate personally took
- Result: Measurable outcomes and impact

Evaluate on: Clarity of each component, specificity, measurable results, relevance
""",
            "technical": """
Technical Framework:
- Architecture: Overall system design and structure
- Implementation: Specific technical approaches and solutions
- Trade-offs: Alternative approaches and justifications
- Impact: Technical outcomes and performance metrics

Evaluate on: Technical depth, design decisions, problem-solving approach, impact
""",
            "general": """
General Framework:
- Clarity: Answer is organized and easy to understand
- Completeness: Fully addresses the question
- Relevance: Content is directly related to the question
- Authenticity: Response feels genuine and well-thought-out

Evaluate on: Communication clarity, completeness, relevance, professionalism
"""
        }
        return frameworks.get(framework.lower(), frameworks["general"])
