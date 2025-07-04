import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// Importaciones refactorizadas
import { connectDB } from './config/database';
import { createApiRoutes } from './routes/api.routes'; 
import authRoutes from './routes/auth.routes';
import Driver from './models/driver.model';

// Cargar variables de entorno
dotenv.config();

// Conectar a la base de datos ANTES de iniciar el servidor
connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// Registramos las rutas
app.use('/api/auth', authRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// --- Lógica de Socket.IO (Actualizada con Salas) ---
io.on('connection', (socket) => {
  console.log(`Un usuario se ha conectado con el socket id: ${socket.id}`);

  // NUEVO EVENTO: El frontend debe emitir este evento después de la conexión,
  // enviando el ID del usuario/conductor logueado.
  socket.on('join-room', (userId: string) => {
    if (userId) {
      console.log(`Usuario ${userId} se ha unido a su sala privada.`);
      socket.join(userId); // El socket se une a una sala con su propio ID.
    }
  });

  // La lógica de 'updateLocation' se mantiene por ahora.
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
      // En el futuro, esta actualización podría emitirse a una sala de viaje específica.
    } catch (error) {
      console.error('Error updating driver location:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Usuario desconectado: ${socket.id}`);
  });
});

// Usamos la función importada y le pasamos la instancia `io` para las rutas de la API.
app.use('/api', createApiRoutes(io));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
