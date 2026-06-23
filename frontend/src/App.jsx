import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import WorkerProfile from './pages/WorkerProfile';
import Chatbot from './pages/Chatbot';
import './App.css';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Navbar />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/worker" element={<WorkerProfile />} />
          <Route path="/chatbot" element={<Chatbot />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
