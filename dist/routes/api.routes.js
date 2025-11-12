"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApiRoutes = void 0;
const express_1 = require("express");
const mongoose_1 = __importDefault(require("mongoose"));
const trip_model_1 = __importDefault(require("../models/trip.model"));
const driver_model_1 = __importDefault(require("../models/driver.model"));
const user_model_1 = __importDefault(require("../models/user.model"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const axios_1 = __importDefault(require("axios"));
const asyncHandler_1 = require("../utils/asyncHandler");
const httpError_1 = require("../utils/httpError");
const httpErrors_1 = require("../utils/httpErrors");
const tripTimers = new Map();
const unwrapObjectId = (value) => {
    if (!value) {
        return undefined;
    }
    if (value instanceof mongoose_1.default.Types.ObjectId) {
        return value.toHexString();
    }
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    const match = trimmed.match(/ObjectId\(["']?([0-9a-fA-F]{24})["']?\)/);
    return match ? match[1] : trimmed;
};
const requireObjectId = (value, fieldName, contextLabel = fieldName) => {
    const normalized = unwrapObjectId(value);
    if (!normalized || !mongoose_1.default.Types.ObjectId.isValid(normalized)) {
        throw httpErrors_1.httpErrors.badRequest(`El identificador proporcionado para ${contextLabel} no es válido.`, {
            field: fieldName,
            value,
        });
    }
    return normalized;
};
const optionalObjectId = (value, fieldName, contextLabel = fieldName) => {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const normalized = unwrapObjectId(value);
    if (!normalized || !mongoose_1.default.Types.ObjectId.isValid(normalized)) {
        throw httpErrors_1.httpErrors.badRequest(`El identificador proporcionado para ${contextLabel} no es válido.`, {
            field: fieldName,
            value,
        });
    }
    return normalized;
};
const createApiRoutes = (io) => {
    const router = (0, express_1.Router)();
    router.get('/drivers/nearby', (0, auth_middleware_1.protect)(['user']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const { lat, lng, maxDistance } = req.query;
        if (!lat || !lng) {
            throw httpErrors_1.httpErrors.badRequest('Se requieren latitud y longitud.', {
                query: req.query,
            });
        }
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);
        if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
            throw httpErrors_1.httpErrors.badRequest('Latitud o longitud no válidas.', {
                lat,
                lng,
            });
        }
        let distance = 5000;
        if (maxDistance && !Number.isNaN(parseFloat(maxDistance))) {
            distance = parseFloat(maxDistance);
        }
        const drivers = await driver_model_1.default.find({
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
        });
        res.json(drivers);
    }));
    router.post('/trips/request', (0, auth_middleware_1.protect)(['user']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const riderId = requireObjectId(req.user?.id, 'userId', 'el usuario');
        const rider = await user_model_1.default.findById(riderId);
        if (!rider || rider.status !== 'active') {
            throw httpErrors_1.httpErrors.forbidden('Tu cuenta no está activa.', { riderId });
        }
        const existingTrip = await trip_model_1.default.findOne({
            riderId,
            status: { $in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] },
        });
        if (existingTrip) {
            throw httpErrors_1.httpErrors.conflict('Ya tienes un viaje en curso.', {
                tripId: existingTrip._id,
            });
        }
        const { pickupLocation, dropoffLocation, pickupName, destinationName, userIndications, paymentMethodId, vehicleTypeRequested = 'standard', maxDistance = 5000, } = req.body;
        if (!pickupLocation || !dropoffLocation || !vehicleTypeRequested) {
            throw httpErrors_1.httpErrors.badRequest('Faltan datos requeridos (ubicaciones o tipo de vehículo).', {
                bodyKeys: Object.keys(req.body ?? {}),
            });
        }
        const paymentMethodNormalized = optionalObjectId(paymentMethodId, 'paymentMethodId', 'el método de pago');
        const paymentMethodObjectId = paymentMethodNormalized
            ? new mongoose_1.default.Types.ObjectId(paymentMethodNormalized)
            : undefined;
        if (typeof maxDistance !== 'number' || maxDistance <= 0) {
            throw httpErrors_1.httpErrors.badRequest('El parámetro maxDistance debe ser un número positivo.', {
                maxDistance,
            });
        }
        const [longitude, latitude] = pickupLocation.coordinates;
        const nearbyDrivers = await driver_model_1.default.find({
            location: {
                $near: {
                    $geometry: { type: 'Point', coordinates: [longitude, latitude] },
                    $maxDistance: maxDistance,
                },
            },
            isAvailable: true,
            // status: 'active',
        });
        if (nearbyDrivers.length === 0) {
            throw httpErrors_1.httpErrors.notFound('No se encontraron conductores cercanos. Inténtalo de nuevo en un momento.', {
                pickupLocation,
            });
        }
        const estimatedFare = 15000;
        const newTrip = new trip_model_1.default({
            riderId,
            pickupLocation,
            dropoffLocation,
            pickupName,
            destinationName,
            userIndications,
            paymentMethodId: paymentMethodObjectId,
            vehicleTypeRequested,
            estimatedFare,
            status: 'REQUESTED',
        });
        await newTrip.save();
        io.emit('new-trip-request', newTrip);
        const tripId = newTrip._id.toString();
        const CANCELLATION_TIMEOUT = 60000;
        const timer = setTimeout(async () => {
            try {
                const trip = await trip_model_1.default.findById(tripId);
                if (trip && trip.status === 'REQUESTED') {
                    trip.status = 'CANCELLED';
                    await trip.save();
                    io.to(`trip-${tripId}`).emit('trip-updated', trip);
                    io.emit('trip-unavailable', { tripId });
                }
            }
            catch (error) {
                console.error('Error en el timeout de cancelación:', error);
            }
            tripTimers.delete(tripId);
        }, CANCELLATION_TIMEOUT);
        tripTimers.set(tripId, timer);
        res.status(201).send(newTrip);
    }));
    router.post('/trips/:tripId/accept', (0, auth_middleware_1.protect)(['driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const session = await mongoose_1.default.startSession();
        session.startTransaction();
        try {
            const tripId = requireObjectId(req.params.tripId, 'tripId', 'el viaje');
            const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
            if (tripTimers.has(tripId)) {
                clearTimeout(tripTimers.get(tripId));
                tripTimers.delete(tripId);
                console.log(`Temporizador para el viaje ${tripId} ha sido cancelado.`);
            }
            const trip = await trip_model_1.default.findById(tripId).session(session);
            if (!trip || trip.status !== 'REQUESTED') {
                throw httpErrors_1.httpErrors.notFound('Viaje no encontrado o ya no está disponible.', {
                    tripId,
                });
            }
            trip.driverId = new mongoose_1.default.Types.ObjectId(driverId);
            trip.status = 'ACCEPTED';
            await trip.save({ session });
            const driver = await driver_model_1.default.findByIdAndUpdate(driverId, { isAvailable: false }, { new: true, session })
                .where({ status: 'active' })
                .select('-password');
            if (!driver) {
                throw httpErrors_1.httpErrors.notFound('No se pudo encontrar al conductor', { driverId });
            }
            if (driver.socketId) {
                const roomName = `trip-${tripId}`;
                const driverSocket = io.sockets.sockets.get(driver.socketId);
                if (driverSocket) {
                    driverSocket.join(roomName);
                    console.log(`Driver ${driverId} forcibly joined to room ${roomName}`);
                }
            }
            await session.commitTransaction();
            io.to(`trip-${tripId}`).emit('trip-accepted', { trip, driver });
            io.emit('trip-unavailable', { tripId });
            res.status(200).send(trip);
        }
        catch (error) {
            await session.abortTransaction();
            if (error instanceof httpError_1.HttpError) {
                throw error;
            }
            throw httpErrors_1.httpErrors.internal('Ocurrió un error al aceptar el viaje.', {
                cause: error,
            });
        }
        finally {
            session.endSession();
        }
    }));
    router.post('/trips/:tripId/start', (0, auth_middleware_1.protect)(['driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const tripId = requireObjectId(req.params.tripId, 'tripId', 'el viaje');
        const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
        const trip = await trip_model_1.default.findById(tripId);
        if (!trip) {
            throw httpErrors_1.httpErrors.notFound('Viaje no encontrado.', { tripId });
        }
        if (trip.driverId?.toString() !== driverId) {
            throw httpErrors_1.httpErrors.forbidden('No tienes permiso para iniciar este viaje.', {
                tripId,
                driverId,
            });
        }
        if (trip.status !== 'ACCEPTED') {
            throw httpErrors_1.httpErrors.badRequest('El viaje no ha sido aceptado.', {
                status: trip.status,
            });
        }
        trip.status = 'IN_PROGRESS';
        trip.tripStartTime = new Date();
        await trip.save();
        io.to(`trip-${tripId}`).emit('trip-updated', trip);
        res.status(200).send(trip);
    }));
    router.post('/trips/:tripId/complete', (0, auth_middleware_1.protect)(['driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const tripId = requireObjectId(req.params.tripId, 'tripId', 'el viaje');
        const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
        const trip = await trip_model_1.default.findById(tripId);
        if (!trip) {
            throw httpErrors_1.httpErrors.notFound('Viaje no encontrado.', { tripId });
        }
        if (trip.driverId?.toString() !== driverId) {
            throw httpErrors_1.httpErrors.forbidden('No tienes permiso para completar este viaje.', {
                tripId,
                driverId,
            });
        }
        if (trip.status !== 'IN_PROGRESS') {
            throw httpErrors_1.httpErrors.badRequest('El viaje no está en progreso.', {
                status: trip.status,
            });
        }
        trip.tripEndTime = new Date();
        if (trip.tripStartTime) {
            trip.duration = (trip.tripEndTime.getTime() - trip.tripStartTime.getTime()) / 1000;
        }
        trip.status = 'COMPLETED';
        await trip.save();
        if (trip.driverId) {
            await driver_model_1.default.findByIdAndUpdate(trip.driverId, { isAvailable: true });
        }
        io.to(`trip-${tripId}`).emit('trip-updated', trip);
        res.status(200).send(trip);
    }));
    router.post('/trips/:tripId/cancel', (0, auth_middleware_1.protect)(['user', 'driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const session = await mongoose_1.default.startSession();
        session.startTransaction();
        try {
            const tripId = requireObjectId(req.params.tripId, 'tripId', 'el viaje');
            const cancellerRole = req.user.role;
            const cancellerLabel = cancellerRole === 'user' ? 'el usuario' : 'el conductor';
            const cancellerField = cancellerRole === 'user' ? 'userId' : 'driverId';
            const cancellerId = requireObjectId(req.user?.id, cancellerField, cancellerLabel);
            const trip = await trip_model_1.default.findById(tripId).session(session);
            if (!trip) {
                throw httpErrors_1.httpErrors.notFound('Viaje no encontrado.', { tripId });
            }
            if (cancellerRole === 'user' && trip.riderId.toString() !== cancellerId) {
                throw httpErrors_1.httpErrors.forbidden('No tienes permiso para cancelar este viaje.', {
                    tripId,
                    cancellerId,
                    expected: trip.riderId,
                });
            }
            if (cancellerRole === 'driver' && trip.driverId?.toString() !== cancellerId) {
                throw httpErrors_1.httpErrors.forbidden('No tienes permiso para cancelar este viaje.', {
                    tripId,
                    cancellerId,
                    expected: trip.driverId,
                });
            }
            if (trip.status !== 'REQUESTED' && trip.status !== 'ACCEPTED') {
                throw httpErrors_1.httpErrors.badRequest('Este viaje ya no puede ser cancelado.', {
                    status: trip.status,
                });
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
            io.to(roomName).emit('trip-updated', trip);
            await session.commitTransaction();
            res.status(200).send(trip);
        }
        catch (error) {
            await session.abortTransaction();
            if (error instanceof httpError_1.HttpError) {
                throw error;
            }
            throw httpErrors_1.httpErrors.internal('Error al cancelar el viaje.', {
                cause: error,
            });
        }
        finally {
            session.endSession();
        }
    }));
    router.patch('/drivers/availability', (0, auth_middleware_1.protect)(['driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
        const { isAvailable } = req.body;
        if (typeof isAvailable !== 'boolean') {
            throw httpErrors_1.httpErrors.badRequest('El campo "isAvailable" debe ser un valor booleano (true o false).', {
                isAvailable,
            });
        }
        if (isAvailable === true) {
            const activeTrip = await trip_model_1.default.findOne({
                driverId,
                status: { $in: ['ACCEPTED', 'IN_PROGRESS'] },
            });
            if (activeTrip) {
                throw httpErrors_1.httpErrors.badRequest('No puedes ponerte disponible mientras estás en un viaje activo.', {
                    tripId: activeTrip._id,
                });
            }
        }
        const updatedDriver = await driver_model_1.default.findByIdAndUpdate(driverId, { isAvailable }, { new: true }).select('-password');
        if (!updatedDriver) {
            throw httpErrors_1.httpErrors.notFound('Conductor no encontrado.', { driverId });
        }
        console.log(`El conductor ${driverId} ha actualizado su disponibilidad a: ${isAvailable}`);
        res.status(200).send(updatedDriver);
    }));
    router.get('/drivers/active-trip', (0, auth_middleware_1.protect)(['driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
        const activeTrip = await trip_model_1.default.findOne({
            driverId,
            status: { $in: ['ACCEPTED', 'IN_PROGRESS'] },
        });
        res.status(200).send({ activeTrip: activeTrip || null });
    }));
    router.get('/drivers/me', (0, auth_middleware_1.protect)(['driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
        const driver = await driver_model_1.default.findById(driverId).select('-password');
        if (!driver) {
            throw httpErrors_1.httpErrors.notFound('Driver not found.', { driverId });
        }
        const activeTrip = await trip_model_1.default.findOne({
            driverId,
            status: { $in: ['ACCEPTED', 'IN_PROGRESS'] },
        }).populate('riderId', 'firstName lastName profileImageUrl averageRating');
        res.status(200).send({ driver, activeTrip });
    }));
    router.get('/trips/history/passenger', (0, auth_middleware_1.protect)(['user']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const passengerId = requireObjectId(req.user?.id, 'userId', 'el pasajero');
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const skip = (page - 1) * limit;
        const trips = await trip_model_1.default.find({ riderId: passengerId })
            .populate('driverId', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const totalTrips = await trip_model_1.default.countDocuments({ riderId: passengerId });
        res.status(200).send({
            totalPages: Math.ceil(totalTrips / limit),
            currentPage: page,
            trips,
        });
    }));
    router.get('/trips/history/driver', (0, auth_middleware_1.protect)(['driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const skip = (page - 1) * limit;
        const trips = await trip_model_1.default.find({ driverId })
            .populate('riderId', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const totalTrips = await trip_model_1.default.countDocuments({ driverId });
        res.status(200).send({
            totalPages: Math.ceil(totalTrips / limit),
            currentPage: page,
            trips,
        });
    }));
    router.get('/trips/rider/active', (0, auth_middleware_1.protect)(['user']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const riderId = requireObjectId(req.user?.id, 'userId', 'el usuario');
        const activeTrip = await trip_model_1.default.findOne({
            riderId,
            status: { $in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] },
        }).populate({
            path: 'driverId',
            select: 'firstName lastName car location',
        });
        if (!activeTrip) {
            throw httpErrors_1.httpErrors.notFound('No se encontró un viaje activo.', { riderId });
        }
        if (!activeTrip.driverId) {
            throw httpErrors_1.httpErrors.notFound('No hay conductor asignado para el viaje actual.', {
                tripId: activeTrip._id,
            });
        }
        res.status(200).send(activeTrip);
    }));
    router.get('/location/reverse-geocode', (0, auth_middleware_1.protect)(['user']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const { lat, lng } = req.query;
        if (!lat || !lng) {
            throw httpErrors_1.httpErrors.badRequest('Latitude and longitude are required query parameters.', {
                query: req.query,
            });
        }
        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
            throw httpErrors_1.httpErrors.badRequest('Latitude and longitude must be valid numbers.', {
                lat,
                lng,
            });
        }
        const apiKey = process.env.LOCATION_IQ_API_KEY;
        if (!apiKey) {
            throw httpErrors_1.httpErrors.internal('Server configuration error.', {
                missingEnv: 'LOCATION_IQ_API_KEY',
            });
        }
        const url = `${process.env.LOCATION_IQ_URL}/reverse.php?key=${apiKey}&lat=${lat}&lon=${lng}&format=json`;
        try {
            const response = await axios_1.default.get(url);
            if (response.data && response.data.display_name) {
                res.status(200).send({ address: response.data.display_name });
                return;
            }
            throw httpErrors_1.httpErrors.notFound('Address not found for the provided coordinates.', {
                lat,
                lng,
            });
        }
        catch (error) {
            if (error instanceof httpError_1.HttpError) {
                throw error;
            }
            const statusCode = axios_1.default.isAxiosError(error) && error.response?.status ? error.response.status : 500;
            const message = axios_1.default.isAxiosError(error)
                ? error.response?.data?.error || 'An error occurred while fetching the address.'
                : 'An error occurred while fetching the address.';
            throw httpErrors_1.httpErrors.fromStatus(statusCode)(message, {
                cause: error,
            });
        }
    }));
    router.post('/drivers/go-offline', (0, auth_middleware_1.protect)(['driver']), (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const { driverId } = req.body;
        if (!driverId) {
            throw httpErrors_1.httpErrors.badRequest('driverId is required.', {
                bodyKeys: Object.keys(req.body ?? {}),
            });
        }
        await driver_model_1.default.findByIdAndUpdate(driverId, { isAvailable: false });
        res.status(204).send();
    }));
    return router;
};
exports.createApiRoutes = createApiRoutes;
//# sourceMappingURL=api.routes.js.map