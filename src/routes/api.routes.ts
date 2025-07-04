/*
* =================================================================
* ARCHIVO ACTUALIZADO Y COMPLETO: src/routes/api.routes.ts
* =================================================================
* Este es el archivo de rutas completo con el middleware `protect`
* aplicado y toda la lógica implementada.
*/

import { Router, Request, Response } from 'express';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import Trip from '../models/trip.model';
import Driver from '../models/driver.model';
import { protect } from '../middleware/auth.middleware';

// Extendemos la interfaz Request para que TypeScript conozca `req.user`
interface AuthenticatedRequest extends Request {
    user?: { id: string; role: string; };
}

export const createApiRoutes = (io: Server) => {
    const router = Router();

    // --- Rutas de Conductores ---

    // La búsqueda de conductores ahora requiere que un 'user' (pasajero) esté logueado.
    router.get('/drivers/nearby', protect(['user']), async (req: Request, res: Response) => {
        try {
            const { lat, lng } = req.query;
            if (!lat || !lng) {
                return res.status(400).send({ error: 'Se requieren latitud y longitud.' });
            }
            const maxDistance = 5000;
            const drivers = await Driver.find({
                location: {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [parseFloat(lng as string), parseFloat(lat as string)]
                        },
                        $maxDistance: maxDistance
                    }
                },
                isAvailable: true
            });
            res.send(drivers);
        } catch (error: any) {
            console.error('Error al buscar conductores cercanos:', error);
            res.status(500).send({ error: 'Ocurrió un error al buscar conductores.' });
        }
    });

    // --- Rutas de Viajes ---

    // Solo un 'user' (pasajero) puede solicitar un viaje.
    router.post('/trips/request', protect(['user']), async (req: AuthenticatedRequest, res: Response) => {
        try {
            const riderId = req.user!.id;
            const { pickupLocation, dropoffLocation } = req.body;

            if (!pickupLocation || !dropoffLocation) {
                return res.status(400).send({ error: 'Se requieren las ubicaciones de recogida y destino.' });
            }

            const newTrip = new Trip({
                riderId,
                pickupLocation,
                dropoffLocation,
                status: 'REQUESTED'
            });
            await newTrip.save();

            const nearbyDrivers = await Driver.find({
                location: {
                    $near: {
                        $geometry: { type: 'Point', coordinates: [pickupLocation.lng, pickupLocation.lat] },
                        $maxDistance: 5000
                    }
                },
                isAvailable: true
            });
            
            if (nearbyDrivers.length > 0) {
                io.emit('new-trip-request', newTrip);
            }

            res.status(201).send(newTrip);
        } catch (error: any) {
            console.error('Error al solicitar el viaje:', error);
            res.status(500).send({ error: 'Ocurrió un error al procesar la solicitud.' });
        }
    });

    // Solo un 'driver' puede aceptar un viaje.
    router.post('/trips/:tripId/accept', protect(['driver']), async (req: AuthenticatedRequest, res: Response) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const { tripId } = req.params;
            const driverId = req.user!.id; // ID del conductor desde el token

            const trip = await Trip.findById(tripId).session(session);
            if (!trip || trip.status !== 'REQUESTED') {
                throw new Error('Viaje no encontrado o ya no está disponible.');
            }

            trip.driverId = new mongoose.Types.ObjectId(driverId);
            trip.status = 'ACCEPTED';
            await trip.save({ session });

            await Driver.findByIdAndUpdate(driverId, { isAvailable: false }, { new: true, session });
            await session.commitTransaction();

            io.emit('trip-accepted', trip);
            io.emit('trip-unavailable', { tripId });

            res.status(200).send(trip);
        } catch (error: any) {
            await session.abortTransaction();
            res.status(500).send({ error: error.message || 'Ocurrió un error al aceptar el viaje.' });
        } finally {
            session.endSession();
        }
    });

    // Solo un 'driver' puede iniciar el viaje.
    router.post('/trips/:tripId/start', protect(['driver']), async (req: Request, res: Response) => {
        try {
            const trip = await Trip.findById(req.params.tripId);
            if (!trip) return res.status(404).send({ error: 'Viaje no encontrado.' });
            if (trip.status !== 'ACCEPTED') return res.status(400).send({ error: 'El viaje no ha sido aceptado.' });

            trip.status = 'IN_PROGRESS';
            await trip.save();
            io.emit('trip-updated', trip);
            res.status(200).send(trip);
        } catch (error: any) {
            res.status(500).send({ error: 'Error al iniciar el viaje.' });
        }
    });

    // Solo un 'driver' puede completar el viaje.
    router.post('/trips/:tripId/complete', protect(['driver']), async (req: Request, res: Response) => {
        try {
            const trip = await Trip.findById(req.params.tripId);
            if (!trip) return res.status(404).send({ error: 'Viaje no encontrado.' });
            if (trip.status !== 'IN_PROGRESS') return res.status(400).send({ error: 'El viaje no está en progreso.' });

            trip.status = 'COMPLETED';
            await trip.save();

            if (trip.driverId) {
                await Driver.findByIdAndUpdate(trip.driverId, { isAvailable: true });
            }
            io.emit('trip-updated', trip);
            res.status(200).send(trip);
        } catch (error: any) {
            res.status(500).send({ error: 'Error al completar el viaje.' });
        }
    });

    // Tanto 'user' como 'driver' pueden cancelar.
    router.post('/trips/:tripId/cancel', protect(['user', 'driver']), async (req: Request, res: Response) => {
        try {
            const trip = await Trip.findById(req.params.tripId);
            if (!trip) return res.status(404).send({ error: 'Viaje no encontrado.' });
            if (trip.status !== 'REQUESTED' && trip.status !== 'ACCEPTED') {
                return res.status(400).send({ error: 'Este viaje ya no puede ser cancelado.' });
            }

            const originalStatus = trip.status;
            trip.status = 'CANCELLED';
            await trip.save();

            if (originalStatus === 'ACCEPTED' && trip.driverId) {
                await Driver.findByIdAndUpdate(trip.driverId, { isAvailable: true });
            }
            io.emit('trip-updated', trip);
            res.status(200).send(trip);
        } catch (error: any) {
            res.status(500).send({ error: 'Error al cancelar el viaje.' });
        }
    });

        router.patch('/drivers/availability', protect(['driver']), async (req: AuthenticatedRequest, res: Response) => {
        try {
            const driverId = req.user!.id;
            const { isAvailable } = req.body;

            // Validación de la entrada
            if (typeof isAvailable !== 'boolean') {
                return res.status(400).send({ error: 'El campo "isAvailable" debe ser un valor booleano (true o false).' });
            }

            // No permitir que un conductor se ponga disponible si está en un viaje activo
            if (isAvailable === true) {
                const activeTrip = await Trip.findOne({
                    driverId: driverId,
                    status: { $in: ['ACCEPTED', 'IN_PROGRESS'] }
                });

                if (activeTrip) {
                    return res.status(400).send({ error: 'No puedes ponerte disponible mientras estás en un viaje activo.' });
                }
            }

            const updatedDriver = await Driver.findByIdAndUpdate(
                driverId,
                { isAvailable: isAvailable },
                { new: true } // Devuelve el documento actualizado
            ).select('-password'); // Excluir la contraseña de la respuesta

            if (!updatedDriver) {
                return res.status(404).send({ error: 'Conductor no encontrado.' });
            }

            console.log(`El conductor ${driverId} ha actualizado su disponibilidad a: ${isAvailable}`);
            res.status(200).send(updatedDriver);

        } catch (error: any) {
            console.error('Error al actualizar la disponibilidad del conductor:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });

      router.get('/drivers/active-trip', protect(['driver']), async (req: AuthenticatedRequest, res: Response) => {
        try {
            const driverId = req.user!.id;

            const activeTrip = await Trip.findOne({
                driverId: driverId,
                status: { $in: ['ACCEPTED', 'IN_PROGRESS'] }
            });

            // Devuelve el viaje si existe, o null si no hay ninguno activo.
            res.status(200).send({ activeTrip: activeTrip || null });

        } catch (error: any) {
            console.error('Error al verificar el viaje activo del conductor:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });

        router.get('/trips/history/passenger', protect(['user']), async (req: AuthenticatedRequest, res: Response) => {
        try {
            const passengerId = req.user!.id;

            const trips = await Trip.find({ riderId: passengerId })
                .populate('driverId', 'name') // Trae el nombre del conductor relacionado
                .sort({ createdAt: -1 }); // Ordena los viajes del más reciente al más antiguo

            res.status(200).send(trips);

        } catch (error: any) {
            console.error('Error al obtener el historial del pasajero:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });

    /**
     * @route   GET /api/trips/history/driver
     * @desc    Obtiene el historial de viajes de un conductor
     * @access  Driver
     */
    router.get('/trips/history/driver', protect(['driver']), async (req: AuthenticatedRequest, res: Response) => {
        try {
            const driverId = req.user!.id;

            const trips = await Trip.find({ driverId: driverId })
                .populate('riderId', 'name') // Trae el nombre del pasajero relacionado
                .sort({ createdAt: -1 }); // Ordena los viajes del más reciente al más antiguo

            res.status(200).send(trips);

        } catch (error: any) {
            console.error('Error al obtener el historial del conductor:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });

    return router;
};
