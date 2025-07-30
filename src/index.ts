import dotenv from 'dotenv';

import express from 'express';

import http from 'http';

import { Server } from 'socket.io';

import cors from 'cors';

import jwt from 'jsonwebtoken'; // <-- 1. IMPORTANTE: Añadir JWT



// Importaciones refactorizadas

import { connectDB } from './config/database';

import { createApiRoutes } from './routes/api.routes';

import authRoutes from './routes/auth.routes';

import Driver from './models/driver.model'; // Asegúrate de que este modelo tenga el campo 'socketId'



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



// --- INICIO: Lógica de Autenticación de Socket y Gestión de socketId ---

// En tu archivo index.ts



io.on('connection', (socket) => {

console.log(`Socket conectado: ${socket.id}`);



socket.on('joinRideRoom', (tripId) => {

if (tripId) {

socket.join(tripId);

console.log(`Socket ${socket.id} se ha unido a la sala del viaje: ${tripId}`);

}

});



const token = socket.handshake.auth.token;

if (!token) {

console.log('Intento de conexión de socket sin token. Desconectando...');

return socket.disconnect();

}


try {

const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string, role: string };


// --- LÓGICA PARA CONDUCTORES ---

if (decoded.role === 'driver') {

const driverId = decoded.id; // Obtenemos el ID de forma segura desde el token



// Guardar/actualizar socketId

Driver.findByIdAndUpdate(driverId, { socketId: socket.id }).exec();

console.log(`Driver [${driverId}] conectado con socket [${socket.id}]`);



// ✅ INICIO: ENDPOINT DE SOCKET PARA ACTUALIZAR UBICACIÓN

socket.on('update-location', async (location: { lat: number; lng: number }) => {

if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {

return; // Ignorar si los datos de ubicación no son válidos

}


// Actualizamos la ubicación del conductor autenticado en esta conexión

await Driver.findByIdAndUpdate(driverId, {

location: {

type: 'Point',

coordinates: [location.lng, location.lat]

}

});

console.log(`Ubicación actualizada para el conductor ${driverId}`);

});

// ✅ FIN: ENDPOINT DE SOCKET



// Limpiar socketId al desconectar

socket.on('disconnect', () => {

console.log(`Driver [${driverId}] desconectado.`);

Driver.findByIdAndUpdate(driverId, { socketId: undefined }).exec();

});

}



// --- LÓGICA PARA PASAJEROS ---

if (decoded.role === 'user') {

socket.on('joinRideRoom', (rideId: string) => {

socket.join(rideId);

console.log(`Pasajero ${decoded.id} se unió a la sala del viaje ${rideId}`);

});

}



} catch (error) {

console.log('Autenticación de socket fallida. Desconectando...');

socket.disconnect();

}

});


app.use('/api', createApiRoutes(io));



const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

console.log(`Servidor corriendo en el puerto ${PORT}`);

});