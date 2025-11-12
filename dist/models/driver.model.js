"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const PointSchema = new mongoose_1.Schema({
    type: {
        type: String,
        enum: ['Point'],
        required: true
    },
    coordinates: {
        type: [Number],
        required: true
    }
}, { _id: false }); // No es necesario un _id para el subdocumento Point
// Esquema principal y final para el Conductor
const DriverSchema = new mongoose_1.Schema({
    // --- Identidad y Contacto ---
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    password: { type: String, required: true, select: false },
    phoneNumber: { type: String, required: true, unique: true },
    profileImageUrl: { type: String, required: false },
    // --- Documentación y Legal ---
    dateOfBirth: { type: Date, required: false },
    licenseDetails: {
        licenseNumber: { type: String },
        expiryDate: { type: Date }
    },
    // --- Información Operativa ---
    location: {
        type: PointSchema,
        required: false,
        index: '2dsphere' // Índice geoespacial para encontrar conductores cercanos
    },
    isAvailable: { type: Boolean, default: false },
    socketId: { type: String, required: false },
    car: {
        model: { type: String },
        plate: { type: String },
        color: { type: String }
    },
    // --- Seguridad y Estado de la Cuenta ---
    isPhoneVerified: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['pending_approval', 'active', 'suspended', 'rejected'],
        default: 'pending_approval'
    },
    fcmToken: { type: String, required: false },
    // --- Estadísticas y Calificaciones ---
    averageRating: { type: Number, default: 5.0 }, // Inicia con calificación perfecta
    ratingsCount: { type: Number, default: 0 },
}, {
    timestamps: true // Añade createdAt y updatedAt automáticamente
});
const Driver = (0, mongoose_1.model)('Driver', DriverSchema);
exports.default = Driver;
//# sourceMappingURL=driver.model.js.map