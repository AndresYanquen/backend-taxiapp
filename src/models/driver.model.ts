import { Schema, model, Document } from 'mongoose';

// Interfaz para la estructura de un punto GeoJSON (subdocumento)
export interface IPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitud, latitud]
}

// Interfaz actualizada del Conductor
export interface IDriver extends Document {
  // --- Identidad y Contacto ---
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  phoneNumber: string;
  profileImageUrl?: string;
  
  // --- Documentación y Legal ---
  dateOfBirth?: Date;
  licenseDetails?: {
    licenseNumber: string;
    expiryDate: Date;
  };

  // --- Información Operativa ---
  location?: IPoint;
  isAvailable: boolean;
  socketId?: string; // <-- AÑADIDO: El eslabón clave para la comunicación en tiempo real
  car?: { // Opcional: añade información del vehículo
    model: string;
    plate: string;
    color: string;
  };
  
  // --- Seguridad y Estado de la Cuenta ---
  isPhoneVerified: boolean;
  isEmailVerified: boolean;
  status: 'pending_approval' | 'active' | 'suspended' | 'rejected';
  fcmToken?: string; // Para notificaciones push

  // --- Estadísticas y Calificaciones ---
  averageRating: number;
  ratingsCount: number;
}

const PointSchema = new Schema<IPoint>({
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
const DriverSchema = new Schema<IDriver>({
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

const Driver = model<IDriver>('Driver', DriverSchema);
export default Driver;
