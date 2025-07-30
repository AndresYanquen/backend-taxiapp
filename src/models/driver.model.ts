import { Schema, model, Document } from 'mongoose';

// Interfaz para la estructura de un punto GeoJSON (no necesita extender Document)
export interface IPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitud, latitud]
}

// Interfaz actualizada del Conductor
export interface IDriver extends Document {
  name: string;
  email: string;
  password?: string;
  location?: IPoint;
  isAvailable: boolean;
  socketId?: string; // <-- AÑADIDO: El eslabón clave para la comunicación en tiempo real
  car?: { // Opcional: añade información del vehículo
    model: string;
    plate: string;
    color: string;
  };
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

const DriverSchema = new Schema<IDriver>({
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

const Driver = model<IDriver>('Driver', DriverSchema);
export default Driver;