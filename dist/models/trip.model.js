"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
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
    riderId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    driverId: { type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Driver',
        default: null,
        index: true
    },
    // Ubicaciones
    pickupLocation: { type: PointSchema,
        required: true,
        index: '2dsphere'
    },
    dropoffLocation: {
        type: PointSchema,
        required: false
    },
    pickupName: { type: String, required: false, default: null },
    destinationName: { type: String, default: null, required: false },
    userIndications: { type: String, default: null, required: false },
    // Estado y Ciclo de Vida
    status: { type: String, enum: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'], default: 'REQUESTED', index: true },
    // Tiempos Clave (se llenan a medida que avanza el viaje)
    driverArrivalTime: { type: Date, required: false },
    tripStartTime: { type: Date, required: false },
    tripEndTime: { type: Date, required: false },
    // Detalles de Ruta
    distance: { type: Number, required: false },
    duration: { type: Number, required: false },
    routePolyline: { type: String, required: false },
    // Finanzas
    estimatedFare: { type: Number, required: false },
    actualFare: { type: Number, required: false },
    cancellationFee: { type: Number, default: 0 },
    paymentMethodId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'PaymentMethod', required: false },
    paymentStatus: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending' },
    transactionId: { type: String, required: false },
    // Cancelación
    cancelledBy: { type: String, enum: ['user', 'driver', 'platform'], required: false },
    cancellationReason: { type: String, required: false },
    // Calificaciones
    riderRatingOfDriver: { type: Number, required: false },
    driverRatingOfRider: { type: Number, required: false },
    riderFeedback: { type: String, required: false },
}, {
    timestamps: true
});
const Trip = mongoose_1.default.model('Trip', TripSchema);
exports.default = Trip;
//# sourceMappingURL=trip.model.js.map