"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const UserSchema = new mongoose_1.Schema({
    // --- Identidad ---
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },
    phoneNumber: { type: String, required: true, unique: true },
    // --- Perfil ---
    profileImageUrl: { type: String, required: false },
    dateOfBirth: { type: Date, required: false },
    gender: { type: String, required: false },
    // --- Seguridad y Verificación ---
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
    signUpMethod: { type: String, enum: ['email', 'google', 'facebook'], default: 'email' },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
    lastLoginAt: { type: Date, required: false },
    // --- Configuración y Notificaciones ---
    language: { type: String, default: 'es' },
    fcmToken: { type: String, required: false },
    emergencyContact: {
        name: { type: String },
        phone: { type: String }
    },
    // --- Estadísticas ---
    averageRating: { type: Number, default: 5.0 }, // Inicia con una calificación perfecta
    ratingsCount: { type: Number, default: 0 },
}, {
    timestamps: true
});
const User = (0, mongoose_1.model)('User', UserSchema);
exports.default = User;
//# sourceMappingURL=user.model.js.map