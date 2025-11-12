import { Router, Request } from 'express';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import Trip from '../models/trip.model';
import Driver from '../models/driver.model';
import User from '../models/user.model';
import { protect } from '../middleware/auth.middleware';
import axios from 'axios';
import { asyncHandler } from '../utils/asyncHandler';
import { HttpError } from '../utils/httpError';
import { httpErrors } from '../utils/httpErrors';

const tripTimers = new Map<string, NodeJS.Timeout>();
const unwrapObjectId = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toHexString();
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/ObjectId\(["']?([0-9a-fA-F]{24})["']?\)/);
  return match ? match[1] : trimmed;
};

const requireObjectId = (value: unknown, fieldName: string, contextLabel = fieldName) => {
  const normalized = unwrapObjectId(value);
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    throw httpErrors.badRequest(`El identificador proporcionado para ${contextLabel} no es válido.`, {
      field: fieldName,
      value,
    });
  }
  return normalized;
};

const optionalObjectId = (value: unknown, fieldName: string, contextLabel = fieldName) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const normalized = unwrapObjectId(value);
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) {
    throw httpErrors.badRequest(`El identificador proporcionado para ${contextLabel} no es válido.`, {
      field: fieldName,
      value,
    });
  }
  return normalized;
};

interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

export const createApiRoutes = (io: Server) => {
  const router = Router();

  router.get(
    '/drivers/nearby',
    protect(['user']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { lat, lng, maxDistance } = req.query;

      if (!lat || !lng) {
        throw httpErrors.badRequest('Se requieren latitud y longitud.', {
          query: req.query,
        });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lng as string);
      if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        throw httpErrors.badRequest('Latitud o longitud no válidas.', {
          lat,
          lng,
        });
      }

      let distance = 5000;
      if (maxDistance && !Number.isNaN(parseFloat(maxDistance as string))) {
        distance = parseFloat(maxDistance as string);
      }

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
      });

      res.json(drivers);
    })
  );

  router.post(
    '/trips/request',
    protect(['user']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const riderId = requireObjectId(req.user?.id, 'userId', 'el usuario');
      const rider = await User.findById(riderId);
      if (!rider || rider.status !== 'active') {
        throw httpErrors.forbidden('Tu cuenta no está activa.', { riderId });
      }

      const existingTrip = await Trip.findOne({
        riderId,
        status: { $in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] },
      });
      if (existingTrip) {
        throw httpErrors.conflict('Ya tienes un viaje en curso.', {
          tripId: existingTrip._id,
        });
      }

      const {
        pickupLocation,
        dropoffLocation,
        pickupName,
        destinationName,
        userIndications,
        paymentMethodId,
        vehicleTypeRequested = 'standard',
        maxDistance = 5000,
      } = req.body;

      if (!pickupLocation || !dropoffLocation || !vehicleTypeRequested) {
        throw httpErrors.badRequest('Faltan datos requeridos (ubicaciones o tipo de vehículo).', {
          bodyKeys: Object.keys(req.body ?? {}),
        });
      }

      const paymentMethodNormalized = optionalObjectId(paymentMethodId, 'paymentMethodId', 'el método de pago');
      const paymentMethodObjectId = paymentMethodNormalized
        ? new mongoose.Types.ObjectId(paymentMethodNormalized)
        : undefined;

      if (typeof maxDistance !== 'number' || maxDistance <= 0) {
        throw httpErrors.badRequest('El parámetro maxDistance debe ser un número positivo.', {
          maxDistance,
        });
      }

      const [longitude, latitude] = pickupLocation.coordinates;
      const nearbyDrivers = await Driver.find({
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
        throw httpErrors.notFound('No se encontraron conductores cercanos. Inténtalo de nuevo en un momento.', {
          pickupLocation,
        });
      }

      const estimatedFare = 15000;

      const newTrip = new Trip({
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
          const trip = await Trip.findById(tripId);
          if (trip && trip.status === 'REQUESTED') {
            trip.status = 'CANCELLED';
            await trip.save();
            io.to(`trip-${tripId}`).emit('trip-updated', trip);
            io.emit('trip-unavailable', { tripId });
          }
        } catch (error) {
          console.error('Error en el timeout de cancelación:', error);
        }
        tripTimers.delete(tripId);
      }, CANCELLATION_TIMEOUT);
      tripTimers.set(tripId, timer);

      res.status(201).send(newTrip);
    })
  );

  router.post(
    '/trips/:tripId/accept',
    protect(['driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const tripId = requireObjectId(req.params.tripId, 'tripId', 'el viaje');
        const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');

        if (tripTimers.has(tripId)) {
          clearTimeout(tripTimers.get(tripId)!);
          tripTimers.delete(tripId);
          console.log(`Temporizador para el viaje ${tripId} ha sido cancelado.`);
        }

        const trip = await Trip.findById(tripId).session(session);
        if (!trip || trip.status !== 'REQUESTED') {
          throw httpErrors.notFound('Viaje no encontrado o ya no está disponible.', {
            tripId,
          });
        }

        trip.driverId = new mongoose.Types.ObjectId(driverId);
        trip.status = 'ACCEPTED';
        await trip.save({ session });

        const driver = await Driver.findByIdAndUpdate(
          driverId,
          { isAvailable: false },
          { new: true, session }
        )
          .where({ status: 'active' })
          .select('-password');

        if (!driver) {
          throw httpErrors.notFound('No se pudo encontrar al conductor', { driverId });
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
      } catch (error) {
        await session.abortTransaction();
        if (error instanceof HttpError) {
          throw error;
        }
        throw httpErrors.internal('Ocurrió un error al aceptar el viaje.', {
          cause: error,
        });
      } finally {
        session.endSession();
      }
    })
  );

  router.post(
    '/trips/:tripId/start',
    protect(['driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const tripId = requireObjectId(req.params.tripId, 'tripId', 'el viaje');
      const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');

      const trip = await Trip.findById(tripId);

      if (!trip) {
        throw httpErrors.notFound('Viaje no encontrado.', { tripId });
      }

      if (trip.driverId?.toString() !== driverId) {
        throw httpErrors.forbidden('No tienes permiso para iniciar este viaje.', {
          tripId,
          driverId,
        });
      }

      if (trip.status !== 'ACCEPTED') {
        throw httpErrors.badRequest('El viaje no ha sido aceptado.', {
          status: trip.status,
        });
      }

      trip.status = 'IN_PROGRESS';
      trip.tripStartTime = new Date();
      await trip.save();

      io.to(`trip-${tripId}`).emit('trip-updated', trip);

      res.status(200).send(trip);
    })
  );

  router.post(
    '/trips/:tripId/complete',
    protect(['driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const tripId = requireObjectId(req.params.tripId, 'tripId', 'el viaje');
      const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');

      const trip = await Trip.findById(tripId);

      if (!trip) {
        throw httpErrors.notFound('Viaje no encontrado.', { tripId });
      }

      if (trip.driverId?.toString() !== driverId) {
        throw httpErrors.forbidden('No tienes permiso para completar este viaje.', {
          tripId,
          driverId,
        });
      }

      if (trip.status !== 'IN_PROGRESS') {
        throw httpErrors.badRequest('El viaje no está en progreso.', {
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
        await Driver.findByIdAndUpdate(trip.driverId, { isAvailable: true });
      }

      io.to(`trip-${tripId}`).emit('trip-updated', trip);

      res.status(200).send(trip);
    })
  );

  router.post(
    '/trips/:tripId/cancel',
    protect(['user', 'driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const tripId = requireObjectId(req.params.tripId, 'tripId', 'el viaje');
        const cancellerRole = req.user!.role;
        const cancellerLabel = cancellerRole === 'user' ? 'el usuario' : 'el conductor';
        const cancellerField = cancellerRole === 'user' ? 'userId' : 'driverId';
        const cancellerId = requireObjectId(req.user?.id, cancellerField, cancellerLabel);

        const trip = await Trip.findById(tripId).session(session);

        if (!trip) {
          throw httpErrors.notFound('Viaje no encontrado.', { tripId });
        }

        if (cancellerRole === 'user' && trip.riderId.toString() !== cancellerId) {
          throw httpErrors.forbidden('No tienes permiso para cancelar este viaje.', {
            tripId,
            cancellerId,
            expected: trip.riderId,
          });
        }
        if (cancellerRole === 'driver' && trip.driverId?.toString() !== cancellerId) {
          throw httpErrors.forbidden('No tienes permiso para cancelar este viaje.', {
            tripId,
            cancellerId,
            expected: trip.driverId,
          });
        }

        if (trip.status !== 'REQUESTED' && trip.status !== 'ACCEPTED') {
          throw httpErrors.badRequest('Este viaje ya no puede ser cancelado.', {
            status: trip.status,
          });
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
        io.to(roomName).emit('trip-updated', trip);

        await session.commitTransaction();
        res.status(200).send(trip);
      } catch (error) {
        await session.abortTransaction();
        if (error instanceof HttpError) {
          throw error;
        }
        throw httpErrors.internal('Error al cancelar el viaje.', {
          cause: error,
        });
      } finally {
        session.endSession();
      }
    })
  );

  router.patch(
    '/drivers/availability',
    protect(['driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
      const { isAvailable } = req.body;

      if (typeof isAvailable !== 'boolean') {
        throw httpErrors.badRequest('El campo "isAvailable" debe ser un valor booleano (true o false).', {
          isAvailable,
        });
      }

      if (isAvailable === true) {
        const activeTrip = await Trip.findOne({
          driverId,
          status: { $in: ['ACCEPTED', 'IN_PROGRESS'] },
        });

        if (activeTrip) {
          throw httpErrors.badRequest('No puedes ponerte disponible mientras estás en un viaje activo.', {
            tripId: activeTrip._id,
          });
        }
      }

      const updatedDriver = await Driver.findByIdAndUpdate(
        driverId,
        { isAvailable },
        { new: true }
      ).select('-password');

      if (!updatedDriver) {
        throw httpErrors.notFound('Conductor no encontrado.', { driverId });
      }

      console.log(`El conductor ${driverId} ha actualizado su disponibilidad a: ${isAvailable}`);
      res.status(200).send(updatedDriver);
    })
  );

  router.get(
    '/drivers/active-trip',
    protect(['driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');

      const activeTrip = await Trip.findOne({
        driverId,
        status: { $in: ['ACCEPTED', 'IN_PROGRESS'] },
      });

      res.status(200).send({ activeTrip: activeTrip || null });
    })
  );

  router.get(
    '/drivers/me',
    protect(['driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');

      const driver = await Driver.findById(driverId).select('-password');
      if (!driver) {
        throw httpErrors.notFound('Driver not found.', { driverId });
      }

      const activeTrip = await Trip.findOne({
        driverId,
        status: { $in: ['ACCEPTED', 'IN_PROGRESS'] },
      }).populate('riderId', 'firstName lastName profileImageUrl averageRating');

      res.status(200).send({ driver, activeTrip });
    })
  );

  router.get(
    '/trips/history/passenger',
    protect(['user']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const passengerId = requireObjectId(req.user?.id, 'userId', 'el pasajero');

      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const skip = (page - 1) * limit;

      const trips = await Trip.find({ riderId: passengerId })
        .populate('driverId', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalTrips = await Trip.countDocuments({ riderId: passengerId });

      res.status(200).send({
        totalPages: Math.ceil(totalTrips / limit),
        currentPage: page,
        trips,
      });
    })
  );

  router.get(
    '/trips/history/driver',
    protect(['driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const driverId = requireObjectId(req.user?.id, 'driverId', 'el conductor');
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const skip = (page - 1) * limit;

      const trips = await Trip.find({ driverId })
        .populate('riderId', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalTrips = await Trip.countDocuments({ driverId });

      res.status(200).send({
        totalPages: Math.ceil(totalTrips / limit),
        currentPage: page,
        trips,
      });
    })
  );

  router.get(
    '/trips/rider/active',
    protect(['user']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const riderId = requireObjectId(req.user?.id, 'userId', 'el usuario');

      const activeTrip = await Trip.findOne({
        riderId,
        status: { $in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] },
      }).populate({
        path: 'driverId',
        select: 'firstName lastName car location',
      });

      if (!activeTrip) {
        throw httpErrors.notFound('No se encontró un viaje activo.', { riderId });
      }

      if (!activeTrip.driverId) {
        throw httpErrors.notFound('No hay conductor asignado para el viaje actual.', {
          tripId: activeTrip._id,
        });
      }

      res.status(200).send(activeTrip);
    })
  );

  router.get(
    '/location/reverse-geocode',
    protect(['user']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { lat, lng } = req.query;

      if (!lat || !lng) {
        throw httpErrors.badRequest('Latitude and longitude are required query parameters.', {
          query: req.query,
        });
      }

      const latNum = parseFloat(lat as string);
      const lngNum = parseFloat(lng as string);

      if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
        throw httpErrors.badRequest('Latitude and longitude must be valid numbers.', {
          lat,
          lng,
        });
      }

      const apiKey = process.env.LOCATION_IQ_API_KEY;
      if (!apiKey) {
        throw httpErrors.internal('Server configuration error.', {
          missingEnv: 'LOCATION_IQ_API_KEY',
        });
      }

      const url = `${process.env.LOCATION_IQ_URL}/reverse.php?key=${apiKey}&lat=${lat}&lon=${lng}&format=json`;

      try {
        const response = await axios.get(url);

        if (response.data && response.data.display_name) {
          res.status(200).send({ address: response.data.display_name });
          return;
        }

        throw httpErrors.notFound('Address not found for the provided coordinates.', {
          lat,
          lng,
        });
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }

        const statusCode = axios.isAxiosError(error) && error.response?.status ? error.response.status : 500;
        const message = axios.isAxiosError(error)
          ? error.response?.data?.error || 'An error occurred while fetching the address.'
          : 'An error occurred while fetching the address.';

        throw httpErrors.fromStatus(statusCode)(message, {
          cause: error,
        });
      }
    })
  );

  router.post(
    '/drivers/go-offline',
    protect(['driver']),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { driverId } = req.body;

      if (!driverId) {
        throw httpErrors.badRequest('driverId is required.', {
          bodyKeys: Object.keys(req.body ?? {}),
        });
      }

      await Driver.findByIdAndUpdate(driverId, { isAvailable: false });
      res.status(204).send();
    })
  );

  return router;
};
