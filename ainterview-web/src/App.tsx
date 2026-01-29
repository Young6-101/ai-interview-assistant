import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { InterviewProvider } from './contexts/InterviewContext'
import { Login } from './pages/Login'
import { Interview } from './pages/Interview'
import './App.css'

function App() {
  return (
    <InterviewProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/interview" element={<Interview />} />
          <Route path="/" element={<Navigate to="/login" />} />
        </Routes>
      </Router>
    </InterviewProvider>
  )
}

export default App