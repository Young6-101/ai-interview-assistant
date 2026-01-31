import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ============ Type Definitions ============

interface LoginResponse {
  access_token: string
  token_type: string
  mode: string
  candidate_id: string
  candidate_name: string
  recorded_at: string
}

interface CurrentUserResponse {
  id: string
  username: string
  email: string
}

interface InterviewResponse {
  id: string
  candidate_name: string
  candidate_email?: string
  mode: string
  status: string
  start_time: string
  end_time?: string
  duration?: number
  transcripts: any[]
  weak_points: any[]
}

interface SurveyResponse {
  id: string
  interview_id: string
  responses: Record<string, string>
  rating: string
  feedback: string
  strengths?: string[]
  improvements?: string[]
  recommendation?: string
  link?: string
}

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
})

// Add token to requests
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token') ?? localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Handle responses
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ============ Auth APIs ============

export const authAPI = {
  login: (candidateName: string, mode: string): Promise<LoginResponse> =>
    apiClient.post('/auth/login', { candidate_name: candidateName, mode }),

  register: (username: string, email: string, password: string, full_name?: string): Promise<{ id: string; username: string; email: string }> =>
    apiClient.post('/auth/register', {
      username,
      email,
      password,
      full_name
    }),

  getCurrentUser: (): Promise<CurrentUserResponse> =>
    apiClient.get('/auth/me'),

  changePassword: (old_password: string, new_password: string): Promise<{ message: string }> =>
    apiClient.post('/auth/change-password', null, {
      params: { old_password, new_password }
    })
}

// ============ Interview APIs ============

export const interviewAPI = {
  createInterview: (data: {
    candidate_name: string
    candidate_email?: string
    mode: string
  }): Promise<InterviewResponse> =>
    apiClient.post('/api/interview/create', data),

  saveInterview: (interview_id: string, data: {
    transcripts: any[]
    weak_points: any[]
    questions_asked: string[]
    suggested_questions: any[]
  }): Promise<{ message: string }> =>
    apiClient.post(`/api/interview/${interview_id}/save`, data),

  listInterviews: (skip = 0, limit = 50): Promise<InterviewResponse[]> =>
    apiClient.get('/api/interview/list', {
      params: { skip, limit }
    }),

  getInterview: (interview_id: string): Promise<InterviewResponse> =>
    apiClient.get(`/api/interview/${interview_id}`),

  deleteInterview: (interview_id: string): Promise<{ message: string }> =>
    apiClient.delete(`/api/interview/${interview_id}`),

  updateInterviewStatus: (interview_id: string, status: string): Promise<{ message: string }> =>
    apiClient.patch(`/api/interview/${interview_id}/status`, null, {
      params: { status }
    })
}

// ============ Survey APIs ============

export const surveyAPI = {
  submitSurvey: (data: {
    interview_id: string
    responses: Record<string, string>
    rating: string
    feedback: string
    strengths?: string[]
    improvements?: string[]
    recommendation?: string
    link?: string
  }): Promise<SurveyResponse> =>
    apiClient.post('/api/survey/submit', data),

  getSurvey: (interview_id: string): Promise<SurveyResponse> =>
    apiClient.get(`/api/survey/${interview_id}`),

  updateSurvey: (interview_id: string, data: any): Promise<SurveyResponse> =>
    apiClient.put(`/api/survey/${interview_id}`, data),

  deleteSurvey: (interview_id: string): Promise<{ message: string }> =>
    apiClient.delete(`/api/survey/${interview_id}`)
}

export default apiClient