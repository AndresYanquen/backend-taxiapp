"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
// 1. Definimos un esquema para el formato GeoJSON Point
const PointSchema = new mongoose_1.Schema({
    type: {
        type: String,
        enum: ['Point'],
        required: true
    },
    coordinates: {
        type: [Number], // Formato [longitud, latitud]
        required: true
    }
});
const TripSchema = new mongoose_1.Schema({
    // 2. Estandarizamos el riderId a ObjectId para mantener consistencia
    riderId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User', // Asume que tienes un modelo 'User' para los pasajeros
        required: true,
        index: true // 3. Añadimos un índice para búsquedas rápidas de historial
    },
    driverId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Driver',
        default: null,
        index: true // Añadimos un índice para búsquedas rápidas
    },
    pickupLocation: {
        type: PointSchema,
        required: true,
        index: '2dsphere' // 4. Índice geoespacial para búsquedas de proximidad
    },
    dropoffLocation: {
        type: PointSchema,
        required: false // Puede que el destino no se conozca al solicitar
    },
    pickupName: { type: String, default: null },
    destinationName: { type: String, default: null },
    userIndications: { type: String, default: null },
    status: {
        type: String,
        enum: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
        default: 'REQUESTED',
        index: true // Añadimos un índice para buscar viajes por estado
    },
    cancelledBy: {
        type: String,
        enum: ['user', 'driver', 'platform'],
    },
    cancellationFee: {
        type: Number,
        default: 0,
    }
}, {
    timestamps: true // Mantiene createdAt y updatedAt automáticamente
});
const Trip = (0, mongoose_1.model)('Trip', TripSchema);
exports.default = Trip;
//# sourceMappingURL=trip.model.js.map