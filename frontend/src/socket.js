import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000';

const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 2000,
  reconnectionAttempts: Infinity,
});

socket.on('connect', () => console.log('[ws] connected:', socket.id));
socket.on('disconnect', (reason) => console.log('[ws] disconnected:', reason));

export default socket;
