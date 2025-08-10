import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { connectDB } from './config/database';
import { createApiRoutes } from './routes/api.routes';
import authRoutes from './routes/auth.routes';
import Driver from './models/driver.model';

// --- Environment and Database Setup ---
dotenv.config();
connectDB();

// --- Security: Validate Environment Variables at Startup ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL ERROR: JWT_SECRET is not defined in .env file.");
  process.exit(1); // Stop the server if the secret is missing
}

// --- Type Definition for JWT Payload ---
interface JwtPayload {
  id: string;
  role: 'user' | 'driver';
}
const corsOptions = {
  // Replace with your Vue app's actual URL
  origin: '*', 
  // Ensure PATCH and OPTIONS are included in the allowed methods
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  // Ensure necessary headers are allowed
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// --- Express App and HTTP Server Setup ---
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use(cors(corsOptions))

const server = http.createServer(app);

// --- Socket.IO Server Setup ---
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Main Socket Connection Handler ---
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  try {
    // 1. Authenticate the socket immediately
    const token = socket.handshake.auth.token;
    if (!token) {
      console.log(`Socket ${socket.id} disconnected: No token provided.`);
      return socket.disconnect();
    }
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    console.log(`Socket ${socket.id} authenticated as ${decoded.role} [${decoded.id}]`);

    // 2. Register event listeners AFTER successful authentication
    if (decoded.role === 'driver') {
      const driverId = decoded.id;

      // Update driver's socket ID for direct communication
      Driver.findByIdAndUpdate(driverId, { socketId: socket.id }).exec();

      socket.on('update-location', async (location: { lat: number; lng: number }) => {
        if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return;
        console.log('driver has updated his location to', location.lat, location.lng)
        await Driver.findByIdAndUpdate(driverId, {
          location: { type: 'Point', coordinates: [location.lng, location.lat] }
        });
      });

    } else if (decoded.role === 'user') {
      socket.on('joinRideRoom', (tripId: string) => {
        if (tripId) {
          const roomName = `trip-${tripId}`; // Use consistent room naming
          socket.join(roomName);
          console.log(`User ${decoded.id} joined room: ${roomName}`);
        }
      });
    }

    // 3. Handle disconnect logic for authenticated users
  socket.on('disconnect', () => {
        console.log(`Socket ${socket} with role '${socket.data.role}' disconnected.`);
        
        // --- MODIFICATION 2: Check the role before querying the database ---
        const token = socket.handshake.auth.token;
        if (!token) {
          console.log(`Socket ${socket.id} disconnected: No token provided.`);
          return socket.disconnect();
        }
        const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

        if (decoded.role === 'driver') {
          Driver.findOneAndUpdate(
            { socketId: socket.id, isAvailable: true },
            { isAvailable: false, socketId: null },
            { new: true } 
          )
          .then(driver => {
            if (driver) {
              console.log(`Driver ${driver.name} was set to offline due to disconnection.`);
            }
          })
          .catch(err => {
            console.error('Error updating driver status on disconnect:', err);
          });
        }
  });

  } catch (error) {
    console.log(`Socket ${socket.id} auth failed, disconnecting:`, error.message);
    socket.disconnect();
  }
});

// --- API Routes and Server Start ---
app.use('/api', createApiRoutes(io));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});