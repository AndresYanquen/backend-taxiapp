import { Router, Request, Response } from 'express';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import Trip from '../models/trip.model';
import Driver from '../models/driver.model';
import User from '../models/user.model'
import { protect } from '../middleware/auth.middleware';
import axios from 'axios'

const tripTimers = new Map<string, NodeJS.Timeout>();


// Extendemos la interfaz Request para que TypeScript conozca `req.user`
interface AuthenticatedRequest extends Request {
    user?: { id: string; role: string; };
}

export const createApiRoutes = (io: Server) => {
    const router = Router();

    // --- Rutas de Conductores ---

    // La búsqueda de conductores ahora requiere que un 'user' (pasajero) esté logueado.
router.get(
  '/drivers/nearby',
  protect(['user']),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { lat, lng, maxDistance } = req.query;

      // Validate coordinates
      if (!lat || !lng) {
        res.status(400).json({ error: 'Se requieren latitud y longitud.' });
        return;
      }

      // Parse values
      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lng as string);
      if (isNaN(latitude) || isNaN(longitude)) {
        res.status(400).json({ error: 'Latitud o longitud no válidas.' });
        return;
      }

      // Parse and validate distance
      let distance = 10000; // default 10km
      if (maxDistance && !isNaN(parseFloat(maxDistance as string))) {
        distance = parseFloat(maxDistance as string);
      }

      // Query nearby drivers
      const drivers = await Driver.find({
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [longitude, latitude],
            },
            $maxDistance: distance,
          },
        },
        isAvailable: true,
        // status: 'active',
      });

      res.json(drivers);
    } catch (error) {
      console.error('Error al buscar conductores cercanos:', error);
      res.status(500).json({ error: 'Ocurrió un error al buscar conductores.' });
    }
  }
);


    // --- Rutas de Viajes ---

    // Solo un 'user' (pasajero) puede solicitar un viaje.
    router.post('/trips/request', protect(['user']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        try {
            const riderId = req.user!.id;

            // --- 1. Verificación del estado del usuario ---
            const rider = await User.findById(riderId);
            if (!rider || rider.status !== 'active') {
                res.status(403).send({ error: 'Tu cuenta no está activa.' });
                return;
            }

            // --- 2. Verificación de viaje duplicado ---
            const existingTrip = await Trip.findOne({
                riderId: riderId,
                status: { $in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] }
            });
            if (existingTrip) {
                res.status(409).send({ error: 'Ya tienes un viaje en curso.' });
                return
            }

            // --- 3. Desestructuración y validación de datos de entrada ---
            const {
                pickupLocation,
                dropoffLocation,
                pickupName,
                destinationName,
                userIndications,
                paymentMethodId = 'tests',
                vehicleTypeRequested = 'standard',
                maxDistance = 5000
            } = req.body;

            if (!pickupLocation || !dropoffLocation || !paymentMethodId || !vehicleTypeRequested) {
                res.status(400).send({ error: 'Faltan datos requeridos (ubicaciones, método de pago o tipo de vehículo).' });
                return;
            }
            if (typeof maxDistance !== 'number' || maxDistance <= 0) {
                res.status(400).send({ error: 'El parámetro maxDistance debe ser un número positivo.' });
                return;
            }
            // (Tu validación de GeoJSON es correcta y puede permanecer aquí si lo deseas)


            // --- 4. BÚSQUEDA DE CONDUCTORES (ANTES DE CREAR EL VIAJE) ---
            const [longitude, latitude] = pickupLocation.coordinates;
            const nearbyDrivers = await Driver.find({
                location: {
                    $near: {
                        $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                        $maxDistance: maxDistance
                    }
                },
                isAvailable: true,
                status: 'active'
            });

            // Si no hay conductores, se rechaza la solicitud y no se crea el viaje.
            if (nearbyDrivers.length === 0) {
                res.status(404).send({ error: 'No se encontraron conductores cercanos. Inténtalo de nuevo en un momento.' });
                return
            }

            const estimatedFare = 15000; 

            const newTrip = new Trip({
                riderId,
                pickupLocation,
                dropoffLocation,
                pickupName,
                destinationName,
                userIndications,
                paymentMethodId,
                vehicleTypeRequested,
                estimatedFare,
                status: 'REQUESTED'
            });

            await newTrip.save();

            // --- 6. Notificación y temporizador de cancelación ---
            io.emit('new-trip-request', newTrip);
            
            // (Tu lógica de temporizador es excelente y permanece aquí)
            const tripId = newTrip._id.toString();
            const CANCELLATION_TIMEOUT = 60000; // 60 segundos
            const timer = setTimeout(async () => {
                try {
                    const trip = await Trip.findById(tripId);
                    if (trip && trip.status === 'REQUESTED') {
                        trip.status = 'CANCELLED';
                        await trip.save();
                        console.log(`Viaje ${tripId} cancelado automáticamente.`);
                        io.to(`trip-${tripId}`).emit('trip-updated', trip);
                        io.emit('trip-unavailable', { tripId });
                    }
                } catch (timeoutError) {
                    console.error('Error en el timeout de cancelación:', timeoutError);
                }
                tripTimers.delete(tripId);
            }, CANCELLATION_TIMEOUT);
            tripTimers.set(tripId, timer);


            // --- 7. Respuesta al cliente ---
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
            const driverId = req.user!.id;

            if (tripTimers.has(tripId)) {
                clearTimeout(tripTimers.get(tripId)!);
                tripTimers.delete(tripId);
                console.log(`Temporizador para el viaje ${tripId} ha sido cancelado.`);
            }

            const trip = await Trip.findById(tripId).session(session);
            if (!trip || trip.status !== 'REQUESTED') {
                throw new Error('Viaje no encontrado o ya no está disponible.');
            }

            trip.driverId = new mongoose.Types.ObjectId(driverId);;
            trip.status = 'ACCEPTED';
            await trip.save({ session });

            const driver = await Driver.findByIdAndUpdate(
                driverId, 
                { isAvailable: false }, 
                { new: true, session }
            ).where({status: 'active'}).select('-password');

            if (!driver){
                throw new Error('No se pudo encontrar al conductor');
            }

            if (driver && driver.socketId) {
                const roomName = `trip-${tripId}`;
                const driverSocket = io.sockets.sockets.get(driver.socketId);
                    if (driverSocket) {
                        driverSocket.join(roomName);
                        console.log(`Driver ${driverId} forcibly joined to room ${roomName}`);
                    }
            }
            await session.commitTransaction();

            // ✅ CORRECTION: Send the event to the correct room name.
            io.to(`trip-${tripId}`).emit('trip-accepted', {trip, driver});
            
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
    router.post('/trips/:tripId/start', protect(['driver']), async (req: AuthenticatedRequest, res: Response) : Promise<void> => {
    try {
        const { tripId } = req.params;
        const driverId = req.user!.id;

        const trip = await Trip.findById(tripId);

        if (!trip) {
            res.status(404).send({ error: 'Viaje no encontrado.' });
            return;
        }

        if (trip.driverId?.toString() !== driverId) {
            res.status(403).send({ error: 'No tienes permiso para iniciar este viaje.' });
            return
        }

        if (trip.status !== 'ACCEPTED') {
            res.status(400).send({ error: 'El viaje no ha sido aceptado.' });
            return;
        }


        trip.status = 'IN_PROGRESS';
        trip.tripStartTime = new Date();
        await trip.save();

        // --- CORRECCIÓN ---
        // Notifica el inicio del viaje solo a la sala específica.
        // io.to(tripId).emit('trip-updated', trip);
        io.to(`trip-${tripId}`).emit('trip-updated', trip);

        
        res.status(200).send(trip);
    } catch (error: any) {
        res.status(500).send({ error: 'Error al iniciar el viaje.' });
    }
    });

    // Solo un 'driver' puede completar el viaje.
    router.post('/trips/:tripId/complete', protect(['driver']), async (req: Request, res: Response) : Promise<void> => {
    try {
        const { tripId } = req.params;
        const driverId = req.user!.id;

        const trip = await Trip.findById(tripId);

        if (!trip) {
            res.status(404).send({ error: 'Viaje no encontrado.' });
            return;
        }

        if (trip.driverId?.toString() !== driverId) {
            res.status(403).send({ error: 'No tienes permiso para completar este viaje.' });
            return;
        }

        if (trip.status !== 'IN_PROGRESS') {
            res.status(400).send({ error: 'El viaje no está en progreso.' });
            return;
        }

        trip.tripEndTime = new Date();

        if (trip.tripStartTime) {
            trip.duration = (trip.tripEndTime.getTime() - trip.tripStartTime.getTime()) / 1000;
        }

        trip.status = 'COMPLETED';
        await trip.save();

        if (trip.driverId) {
            await Driver.findByIdAndUpdate(trip.driverId, { isAvailable: true });
        }

        // --- CORRECCIÓN ---
        // Notifica la finalización del viaje solo a la sala específica.
        io.to(`trip-${tripId}`).emit('trip-updated', trip);

        
        res.status(200).send(trip);
    } catch (error: any) {
        res.status(500).send({ error: 'Error al completar el viaje.' });
    }
    });

    // Tanto 'user' como 'driver' pueden cancelar.
    router.post('/trips/:tripId/cancel', protect(['user', 'driver']), async (req: AuthenticatedRequest, res: Response) => {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const { tripId } = req.params;
            const cancellerRole = req.user!.role;
            const cancellerId = req.user!.id;

            const trip = await Trip.findById(tripId).session(session);

            if (!trip) {
                throw new Error('Viaje no encontrado.');
            }

            if (cancellerRole === 'user' && trip.riderId.toString() !== cancellerId) {
                throw new Error('No tienes permiso para cancelar este viaje.');
            }
            if (cancellerRole === 'driver' && trip.driverId?.toString() !== cancellerId) {
                throw new Error('No tienes permiso para cancelar este viaje.');
            }

            if (trip.status !== 'REQUESTED' && trip.status !== 'ACCEPTED') {
                throw new Error('Este viaje ya no puede ser cancelado.');
            }

            if (tripTimers.has(tripId)) {
                clearTimeout(tripTimers.get(tripId)!);
                tripTimers.delete(tripId);
            }

            const originalStatus = trip.status;
            trip.status = 'CANCELLED';
            trip.cancelledBy = cancellerRole as 'user' | 'driver';

            const CANCELLATION_FEE = 5000;
            const GRACE_PERIOD_MS = 2 * 60 * 1000;

            if (cancellerRole === 'user' && originalStatus === 'ACCEPTED') {
                const timeSinceAccepted = Date.now() - new Date(trip.updatedAt).getTime();
                if (timeSinceAccepted > GRACE_PERIOD_MS) {
                    trip.cancellationFee = CANCELLATION_FEE;
                }
            }

            if (originalStatus === 'ACCEPTED' && trip.driverId) {
                await Driver.findByIdAndUpdate(trip.driverId, { isAvailable: true }, { session });
            }
            
            await trip.save({ session });
            
            const roomName = `trip-${tripId}`;
            console.log(`Attempting to emit 'trip-updated' to room: ${roomName}`);
            io.to(`trip-${tripId}`).emit('trip-updated', trip);
            
            await session.commitTransaction();
            res.status(200).send(trip);

        } catch (error: any) {
            await session.abortTransaction();
            res.status(500).send({ error: error.message || 'Error al cancelar el viaje.' });
        } finally {
            session.endSession();
        }
    });

    router.patch('/drivers/availability', protect(['driver']), async (req: AuthenticatedRequest, res: Response) : Promise<void> =>{
    try {
        const driverId = req.user!.id;
        const { isAvailable } = req.body;

        // Validación de la entrada
        if (typeof isAvailable !== 'boolean') {
            res.status(400).send({ error: 'El campo "isAvailable" debe ser un valor booleano (true o false).' });
            return
        }

        // No permitir que un conductor se ponga disponible si está en un viaje activo
        if (isAvailable === true) {
            const activeTrip = await Trip.findOne({
                driverId: driverId,
                status: { $in: ['ACCEPTED', 'IN_PROGRESS'] }
            });

            if (activeTrip) {
                res.status(400).send({ error: 'No puedes ponerte disponible mientras estás en un viaje activo.' });
                return
            }
        }

        const updatedDriver = await Driver.findByIdAndUpdate(
            driverId,
            { isAvailable: isAvailable },
            { new: true } // Devuelve el documento actualizado
        ).select('-password'); 
        
        

        if (!updatedDriver) {
            res.status(404).send({ error: 'Conductor no encontrado.' });
            return 
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


    // In api.routes.ts

// Gets the current driver's profile and any active trip
    router.get('/drivers/me', protect(['driver']), async (req: AuthenticatedRequest, res: Response) : Promise<void> => {
        try {
            const driverId = req.user!.id;
            
            // Find the driver's main profile
            const driver = await Driver.findById(driverId).select('-password');
            if (!driver) {
                res.status(404).send({ error: 'Driver not found.' });
                return 
            }

            // Find any active trip for that driver
            const activeTrip = await Trip.findOne({
                driverId: driverId,
                status: { $in: ['ACCEPTED', 'IN_PROGRESS'] }
            }).populate('riderId', 'firstName lastName profileImageUrl averageRating');

            // Send both pieces of information back
            res.status(200).send({ driver, activeTrip });

        } catch (error: any) {
            res.status(500).send({ error: 'Server error.' });
        }
    });

    router.get('/trips/history/passenger', protect(['user']), async (req: AuthenticatedRequest, res: Response) => {
        try {
            const passengerId = req.user!.id;

            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = parseInt(req.query.limit as string, 10) || 10; // Por defecto, 10 viajes por página.
            const skip = (page - 1) * limit;

            const trips = await Trip.find({ riderId: passengerId })
                .populate('driverId', 'firstName lastName') // Trae el nombre del conductor relacionado
                .sort({ createdAt: -1 })
                .skip(skip)   // <-- Se salta los resultados de las páginas anteriores
                .limit(limit); ; // Ordena los viajes del más reciente al más antiguo

            const totalTrips = await Trip.countDocuments({ riderId: passengerId });

            res.status(200).send({
                totalPages: Math.ceil(totalTrips / limit),
                currentPage: page,
                trips
            });

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
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = parseInt(req.query.limit as string, 10) || 10;
            const skip = (page - 1) * limit;

            const trips = await Trip.find({ driverId: driverId })
                .populate('riderId', 'firstName lastName') // Trae el nombre del pasajero relacionado
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);; // Ordena los viajes del más reciente al más antiguo

                    const totalTrips = await Trip.countDocuments({ driverId: driverId });

            res.status(200).send({
                totalPages: Math.ceil(totalTrips / limit),
                currentPage: page,
                trips
            });

        } catch (error: any) {
            console.error('Error al obtener el historial del conductor:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });


    router.get('/trips/rider/active', protect(['user']), async (req: AuthenticatedRequest, res: Response) => {
        try {
            const riderId = req.user!.id;

            const activeTrip = await Trip.findOne({
                riderId: riderId,
                status: { $in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] }
            })
            // Use .populate() to include the driver's data, including their location
            .populate({
                path: 'driverId',
                select: 'firstName lastName car location' // Specify the fields you need
            });

            res.status(200).send(activeTrip);

        } catch (error: any) {
            console.error('Error fetching active ride for rider:', error);
            res.status(500).send({ error: 'A server error occurred.' });
        }
    });

    router.get('/location/reverse-geocode', protect(['user']), async (req: AuthenticatedRequest, res: Response) : Promise<void> =>{
        const { lat, lng } = req.query;

        // 1. Validate input from the client
        if (!lat || !lng) {
            res.status(400).send({ error: 'Latitude and longitude are required query parameters.' });
            return;
        }

        const latNum = parseFloat(lat as string);
        const lngNum = parseFloat(lng as string);

        if (isNaN(latNum) || isNaN(lngNum)) {
            res.status(400).send({ error: 'Latitude and longitude must be valid numbers.' });
            return;
        }

        // 2. Securely get the API key from environment variables
        const apiKey = process.env.LOCATION_IQ_API_KEY;
        if (!apiKey) {
            console.error('FATAL: LOCATIONIQ_API_KEY is not defined in the environment variables.');
            res.status(500).send({ error: 'Server configuration error.' });
            return;
        }

        const url = `${process.env.LOCATION_IQ_URL}/reverse.php?key=${apiKey}&lat=${lat}&lon=${lng}&format=json`;

        try {
            // 3. Make the external API call to LocationIQ
            const response = await axios.get(url);

            // 4. Check for a valid response and send the address back
            if (response.data && response.data.display_name) {
                res.status(200).send({ address: response.data.display_name });
                return;
            } else {
                // This case handles when LocationIQ returns a 200 OK but can't find an address
                res.status(404).send({ error: 'Address not found for the provided coordinates.' });
                return;
            }
        } catch (error: any) {
            // 5. Handle errors from the external API (e.g., invalid key, rate limits)
            console.error('LocationIQ reverse geocoding error:', error.response?.data || error.message);
            res.status(500).send({ error: 'An error occurred while fetching the address.' });
            return;
        }
    });

    router.post('/drivers/go-offline', protect(['driver']) , async (req: Request, res: Response): Promise<void> => {
        const { driverId } = req.body;

        if (!driverId) {
            res.status(400).send({ error: 'driverId is required.' });
        }

        try {
            await Driver.findByIdAndUpdate(driverId, { isAvailable: false });
            // Send a 204 No Content response as we don't need to return data
            res.status(204).send();
        } catch (error: any) {
            // We can't do much if this fails, but we can log it
            console.error('Error in /go-offline endpoint:', error);
            res.status(500).send({ error: 'Server error while setting driver offline.' });
        }
    });

    return router;
};
