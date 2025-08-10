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
const DriverSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: [true, 'El nombre es obligatorio.']
    },
    email: {
        type: String,
        required: [true, 'El email es obligatorio.'],
        unique: true,
        lowercase: true,
        index: true // Indexar email para búsquedas de login rápidas
    },
    password: {
        type: String,
        required: [true, 'La contraseña es obligatoria.'],
        select: false // No devolver la contraseña en las consultas por defecto
    },
    location: {
        type: PointSchema,
        required: false,
        index: '2dsphere' // Índice geoespacial para encontrar conductores cercanos
    },
    isAvailable: {
        type: Boolean,
        default: false // Es más seguro que un conductor empiece como 'offline'
    },
    // --- CAMPO AÑADIDO ---
    socketId: {
        type: String,
        required: false // No todos los conductores estarán conectados en todo momento
    },
    car: {
        model: String,
        plate: String,
        color: String
    }
}, {
    timestamps: true
});
const Driver = (0, mongoose_1.model)('Driver', DriverSchema);
exports.default = Driver;
//# sourceMappingURL=driver.model.js.map