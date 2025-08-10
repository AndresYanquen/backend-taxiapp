"use strict";
/*
* =================================================================
* ARCHIVO ACTUALIZADO Y COMPLETO: src/routes/api.routes.ts
* =================================================================
* Este es el archivo de rutas completo con el middleware `protect`
* aplicado y la lógica de creación de viajes actualizada.
*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApiRoutes = void 0;
const express_1 = require("express");
const mongoose_1 = __importDefault(require("mongoose"));
const trip_model_1 = __importDefault(require("../models/trip.model"));
const driver_model_1 = __importDefault(require("../models/driver.model"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const axios_1 = __importDefault(require("axios"));
const tripTimers = new Map();
const createApiRoutes = (io) => {
    const router = (0, express_1.Router)();
    // --- Rutas de Conductores ---
    // La búsqueda de conductores ahora requiere que un 'user' (pasajero) esté logueado.
    router.get('/drivers/nearby', (0, auth_middleware_1.protect)(['user']), async (req, res) => {
        try {
            const { lat, lng } = req.query;
            if (!lat || !lng) {
                return res.status(400).send({ error: 'Se requieren latitud y longitud.' });
            }
            const maxDistance = 5000;
            const drivers = await driver_model_1.default.find({
                location: {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: [parseFloat(lng), parseFloat(lat)]
                        },
                        $maxDistance: maxDistance
                    }
                },
                isAvailable: true
            });
            res.send(drivers);
        }
        catch (error) {
            console.error('Error al buscar conductores cercanos:', error);
            res.status(500).send({ error: 'Ocurrió un error al buscar conductores.' });
        }
    });
    // --- Rutas de Viajes ---
    // Solo un 'user' (pasajero) puede solicitar un viaje.
    router.post('/trips/request', (0, auth_middleware_1.protect)(['user']), async (req, res) => {
        try {
            const riderId = req.user.id;
            // 1. Verificación de viaje duplicado (sin cambios)
            const existingTrip = await trip_model_1.default.findOne({
                riderId: riderId,
                status: { $in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] }
            });
            if (existingTrip) {
                return res.status(409).send({
                    error: 'Ya tienes un viaje en curso.'
                });
            }
            const { pickupLocation, // Este es el objeto GeoJSON
            dropoffLocation, pickupName, destinationName, userIndications } = req.body;
            // --- INICIO DE LA VALIDACIÓN CORREGIDA ---
            // 2. Validar que 'pickupLocation' tenga el formato GeoJSON esperado.
            if (!pickupLocation ||
                pickupLocation.type !== 'Point' ||
                !Array.isArray(pickupLocation.coordinates) ||
                pickupLocation.coordinates.length !== 2) {
                // Si no cumple la estructura, rechaza la solicitud.
                return res.status(400).send({ error: 'El formato de la ubicación de recogida es inválido.' });
            }
            // --- FIN DE LA VALIDACIÓN CORREGIDA ---
            // 3. Proceder con la creación del viaje
            const newTrip = new trip_model_1.default({
                riderId,
                pickupLocation, // Guarda el objeto GeoJSON completo
                dropoffLocation,
                pickupName,
                destinationName,
                userIndications,
                status: 'REQUESTED'
            });
            await newTrip.save();
            const tripId = newTrip._id.toString();
            const CANCELLATION_TIMEOUT = 60000; // 60 segundos
            const timer = setTimeout(async () => {
                try {
                    const trip = await trip_model_1.default.findById(tripId);
                    // Solo cancela si nadie lo ha aceptado aún
                    if (trip && trip.status === 'REQUESTED') {
                        trip.status = 'CANCELLED';
                        await trip.save();
                        console.log(`Viaje ${tripId} cancelado automáticamente por falta de respuesta.`);
                        // Notifica al pasajero que su viaje fue cancelado
                        io.to(`trip-${tripId}`).emit('trip-updated', trip);
                        // Notifica a los conductores que la solicitud ya no está disponible
                        io.emit('trip-unavailable', { tripId });
                    }
                }
                catch (timeoutError) {
                    console.error('Error en el timeout de cancelación del viaje:', timeoutError);
                }
                // Limpia el temporizador del Map una vez que se ha ejecutado
                tripTimers.delete(tripId);
            }, CANCELLATION_TIMEOUT);
            // Guarda la referencia al temporizador
            tripTimers.set(tripId, timer);
            // 4. Buscar conductores cercanos usando las coordenadas
            const [longitude, latitude] = pickupLocation.coordinates;
            const nearbyDrivers = await driver_model_1.default.find({
                location: {
                    $near: {
                        $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                        $maxDistance: 5000 // 5km
                    }
                },
                isAvailable: true
            });
            if (nearbyDrivers.length > 0) {
                io.emit('new-trip-request', newTrip);
            }
            res.status(201).send(newTrip);
        }
        catch (error) {
            console.error('Error al solicitar el viaje:', error);
            res.status(500).send({ error: 'Ocurrió un error al procesar la solicitud.' });
        }
    });
    // Solo un 'driver' puede aceptar un viaje.
    router.post('/trips/:tripId/accept', (0, auth_middleware_1.protect)(['driver']), async (req, res) => {
        const session = await mongoose_1.default.startSession();
        session.startTransaction();
        try {
            const { tripId } = req.params;
            const driverId = req.user.id;
            if (tripTimers.has(tripId)) {
                clearTimeout(tripTimers.get(tripId));
                tripTimers.delete(tripId);
                console.log(`Temporizador para el viaje ${tripId} ha sido cancelado.`);
            }
            const trip = await trip_model_1.default.findById(tripId).session(session);
            if (!trip || trip.status !== 'REQUESTED') {
                throw new Error('Viaje no encontrado o ya no está disponible.');
            }
            trip.driverId = new mongoose_1.default.Types.ObjectId(driverId);
            trip.status = 'ACCEPTED';
            await trip.save({ session });
            const driver = await driver_model_1.default.findByIdAndUpdate(driverId, { isAvailable: false }, { new: true, session }).select('-password');
            if (!driver) {
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
            io.to(`trip-${tripId}`).emit('trip-accepted', { trip, driver });
            io.emit('trip-unavailable', { tripId });
            res.status(200).send(trip);
        }
        catch (error) {
            await session.abortTransaction();
            res.status(500).send({ error: error.message || 'Ocurrió un error al aceptar el viaje.' });
        }
        finally {
            session.endSession();
        }
    });
    // Solo un 'driver' puede iniciar el viaje.
    router.post('/trips/:tripId/start', (0, auth_middleware_1.protect)(['driver']), async (req, res) => {
        try {
            const { tripId } = req.params;
            const trip = await trip_model_1.default.findById(tripId);
            if (!trip) {
                return res.status(404).send({ error: 'Viaje no encontrado.' });
            }
            if (trip.status !== 'ACCEPTED') {
                return res.status(400).send({ error: 'El viaje no ha sido aceptado.' });
            }
            trip.status = 'IN_PROGRESS';
            await trip.save();
            // --- CORRECCIÓN ---
            // Notifica el inicio del viaje solo a la sala específica.
            // io.to(tripId).emit('trip-updated', trip);
            io.to(`trip-${tripId}`).emit('trip-updated', trip);
            res.status(200).send(trip);
        }
        catch (error) {
            res.status(500).send({ error: 'Error al iniciar el viaje.' });
        }
    });
    // Solo un 'driver' puede completar el viaje.
    router.post('/trips/:tripId/complete', (0, auth_middleware_1.protect)(['driver']), async (req, res) => {
        try {
            const { tripId } = req.params;
            const trip = await trip_model_1.default.findById(tripId);
            if (!trip) {
                return res.status(404).send({ error: 'Viaje no encontrado.' });
            }
            if (trip.status !== 'IN_PROGRESS') {
                return res.status(400).send({ error: 'El viaje no está en progreso.' });
            }
            trip.status = 'COMPLETED';
            await trip.save();
            if (trip.driverId) {
                await driver_model_1.default.findByIdAndUpdate(trip.driverId, { isAvailable: true });
            }
            // --- CORRECCIÓN ---
            // Notifica la finalización del viaje solo a la sala específica.
            io.to(`trip-${tripId}`).emit('trip-updated', trip);
            res.status(200).send(trip);
        }
        catch (error) {
            res.status(500).send({ error: 'Error al completar el viaje.' });
        }
    });
    // Tanto 'user' como 'driver' pueden cancelar.
    router.post('/trips/:tripId/cancel', (0, auth_middleware_1.protect)(['user', 'driver']), async (req, res) => {
        const session = await mongoose_1.default.startSession();
        session.startTransaction();
        try {
            const { tripId } = req.params;
            const cancellerRole = req.user.role;
            const cancellerId = req.user.id;
            const trip = await trip_model_1.default.findById(tripId).session(session);
            if (!trip) {
                throw new Error('Viaje no encontrado.');
            }
            if (trip.status !== 'REQUESTED' && trip.status !== 'ACCEPTED') {
                throw new Error('Este viaje ya no puede ser cancelado.');
            }
            if (tripTimers.has(tripId)) {
                clearTimeout(tripTimers.get(tripId));
                tripTimers.delete(tripId);
            }
            const originalStatus = trip.status;
            trip.status = 'CANCELLED';
            trip.cancelledBy = cancellerRole;
            const CANCELLATION_FEE = 5000;
            const GRACE_PERIOD_MS = 2 * 60 * 1000;
            if (cancellerRole === 'user' && originalStatus === 'ACCEPTED') {
                const timeSinceAccepted = Date.now() - new Date(trip.updatedAt).getTime();
                if (timeSinceAccepted > GRACE_PERIOD_MS) {
                    trip.cancellationFee = CANCELLATION_FEE;
                }
            }
            if (originalStatus === 'ACCEPTED' && trip.driverId) {
                await driver_model_1.default.findByIdAndUpdate(trip.driverId, { isAvailable: true }, { session });
            }
            await trip.save({ session });
            const roomName = `trip-${tripId}`;
            console.log(`Attempting to emit 'trip-updated' to room: ${roomName}`);
            io.to(`trip-${tripId}`).emit('trip-updated', trip);
            await session.commitTransaction();
            res.status(200).send(trip);
        }
        catch (error) {
            await session.abortTransaction();
            res.status(500).send({ error: error.message || 'Error al cancelar el viaje.' });
        }
        finally {
            session.endSession();
        }
    });
    router.patch('/drivers/availability', (0, auth_middleware_1.protect)(['driver']), async (req, res) => {
        try {
            const driverId = req.user.id;
            const { isAvailable } = req.body;
            // Validación de la entrada
            if (typeof isAvailable !== 'boolean') {
                return res.status(400).send({ error: 'El campo "isAvailable" debe ser un valor booleano (true o false).' });
            }
            // No permitir que un conductor se ponga disponible si está en un viaje activo
            if (isAvailable === true) {
                const activeTrip = await trip_model_1.default.findOne({
                    driverId: driverId,
                    status: { $in: ['ACCEPTED', 'IN_PROGRESS'] }
                });
                if (activeTrip) {
                    return res.status(400).send({ error: 'No puedes ponerte disponible mientras estás en un viaje activo.' });
                }
            }
            const updatedDriver = await driver_model_1.default.findByIdAndUpdate(driverId, { isAvailable: isAvailable }, { new: true } // Devuelve el documento actualizado
            ).select('-password'); // Excluir la contraseña de la respuesta
            if (!updatedDriver) {
                return res.status(404).send({ error: 'Conductor no encontrado.' });
            }
            console.log(`El conductor ${driverId} ha actualizado su disponibilidad a: ${isAvailable}`);
            res.status(200).send(updatedDriver);
        }
        catch (error) {
            console.error('Error al actualizar la disponibilidad del conductor:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });
    router.get('/drivers/active-trip', (0, auth_middleware_1.protect)(['driver']), async (req, res) => {
        try {
            const driverId = req.user.id;
            const activeTrip = await trip_model_1.default.findOne({
                driverId: driverId,
                status: { $in: ['ACCEPTED', 'IN_PROGRESS'] }
            });
            // Devuelve el viaje si existe, o null si no hay ninguno activo.
            res.status(200).send({ activeTrip: activeTrip || null });
        }
        catch (error) {
            console.error('Error al verificar el viaje activo del conductor:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });
    // In api.routes.ts
    // Gets the current driver's profile and any active trip
    router.get('/drivers/me', (0, auth_middleware_1.protect)(['driver']), async (req, res) => {
        try {
            const driverId = req.user.id;
            // Find the driver's main profile
            const driver = await driver_model_1.default.findById(driverId);
            if (!driver) {
                return res.status(404).send({ error: 'Driver not found.' });
            }
            // Find any active trip for that driver
            const activeTrip = await trip_model_1.default.findOne({
                driverId: driverId,
                status: { $in: ['ACCEPTED', 'IN_PROGRESS'] }
            });
            // Send both pieces of information back
            res.status(200).send({ driver, activeTrip });
        }
        catch (error) {
            res.status(500).send({ error: 'Server error.' });
        }
    });
    router.get('/trips/history/passenger', (0, auth_middleware_1.protect)(['user']), async (req, res) => {
        try {
            const passengerId = req.user.id;
            const trips = await trip_model_1.default.find({ riderId: passengerId })
                .populate('driverId', 'name') // Trae el nombre del conductor relacionado
                .sort({ createdAt: -1 }); // Ordena los viajes del más reciente al más antiguo
            res.status(200).send(trips);
        }
        catch (error) {
            console.error('Error al obtener el historial del pasajero:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });
    /**
     * @route   GET /api/trips/history/driver
     * @desc    Obtiene el historial de viajes de un conductor
     * @access  Driver
     */
    router.get('/trips/history/driver', (0, auth_middleware_1.protect)(['driver']), async (req, res) => {
        try {
            const driverId = req.user.id;
            const trips = await trip_model_1.default.find({ driverId: driverId })
                .populate('riderId', 'name') // Trae el nombre del pasajero relacionado
                .sort({ createdAt: -1 }); // Ordena los viajes del más reciente al más antiguo
            res.status(200).send(trips);
        }
        catch (error) {
            console.error('Error al obtener el historial del conductor:', error);
            res.status(500).send({ error: 'Ocurrió un error en el servidor.' });
        }
    });
    router.get('/trips/rider/active', (0, auth_middleware_1.protect)(['user']), async (req, res) => {
        try {
            const riderId = req.user.id;
            const activeTrip = await trip_model_1.default.findOne({
                riderId: riderId,
                status: { $in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] }
            })
                // Use .populate() to include the driver's data, including their location
                .populate({
                path: 'driverId',
                select: 'name car location' // Specify the fields you need
            });
            res.status(200).send(activeTrip);
        }
        catch (error) {
            console.error('Error fetching active ride for rider:', error);
            res.status(500).send({ error: 'A server error occurred.' });
        }
    });
    router.get('/location/reverse-geocode', (0, auth_middleware_1.protect)(['user']), async (req, res) => {
        const { lat, lng } = req.query;
        // 1. Validate input from the client
        if (!lat || !lng) {
            return res.status(400).send({ error: 'Latitude and longitude are required query parameters.' });
        }
        // 2. Securely get the API key from environment variables
        const apiKey = process.env.LOCATION_IQ_API_KEY;
        if (!apiKey) {
            console.error('FATAL: LOCATIONIQ_API_KEY is not defined in the environment variables.');
            return res.status(500).send({ error: 'Server configuration error.' });
        }
        const url = `${process.env.LOCATION_IQ_URL}/reverse.php?key=${apiKey}&lat=${lat}&lon=${lng}&format=json`;
        try {
            // 3. Make the external API call to LocationIQ
            const response = await axios_1.default.get(url);
            // 4. Check for a valid response and send the address back
            if (response.data && response.data.display_name) {
                res.status(200).send({ address: response.data.display_name });
            }
            else {
                // This case handles when LocationIQ returns a 200 OK but can't find an address
                res.status(404).send({ error: 'Address not found for the provided coordinates.' });
            }
        }
        catch (error) {
            // 5. Handle errors from the external API (e.g., invalid key, rate limits)
            console.error('LocationIQ reverse geocoding error:', error.response?.data || error.message);
            res.status(500).send({ error: 'An error occurred while fetching the address.' });
        }
    });
    router.post('/drivers/go-offline', async (req, res) => {
        const { driverId } = req.body;
        if (!driverId) {
            return res.status(400).send({ error: 'driverId is required.' });
        }
        try {
            await driver_model_1.default.findByIdAndUpdate(driverId, { isAvailable: false });
            // Send a 204 No Content response as we don't need to return data
            res.status(204).send();
        }
        catch (error) {
            // We can't do much if this fails, but we can log it
            console.error('Error in /go-offline endpoint:', error);
            res.status(500).send({ error: 'Server error while setting driver offline.' });
        }
    });
    return router;
};
exports.createApiRoutes = createApiRoutes;
//# sourceMappingURL=api.routes.js.map