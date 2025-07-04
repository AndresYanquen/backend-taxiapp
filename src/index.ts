import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import Driver from './models/driver.model';
import apiRoutes from './routes/api.routes';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // En producción, restringir al dominio del frontend
    methods: ["GET", "POST"]
  }
});

mongoose.connect(process.env.MONGO_URI!)
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

io.on('connection', (socket) => {
  console.log(`A user connected with socket id: ${socket.id}`);

  socket.on('updateLocation', async (data: { driverId: string; location: { lat: number; lng: number } }) => {
    const { driverId, location } = data;
    if (!driverId || !location) return;

    console.log(`Updating location for driver ${driverId}:`, location);
    try {
      await Driver.findByIdAndUpdate(driverId, {
        location: {
          type: 'Point',
          coordinates: [location.lng, location.lat]
        }
      });
    } catch (error) {
      console.error('Error updating driver location:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

app.use('/api', apiRoutes);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});