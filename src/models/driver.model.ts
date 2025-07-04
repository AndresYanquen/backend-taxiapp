import { Schema, model, Document } from 'mongoose';

// La interface IPoint no cambia
export interface IPoint extends Document {
  type: 'Point';
  coordinates: [number, number];
}

// Actualizamos la interface del Conductor
export interface IDriver extends Document {
  name: string;
  email: string; // <-- AÑADIDO
  password?: string; // <-- AÑADIDO (opcional por seguridad)
  location: IPoint;
  isAvailable: boolean;
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
});

const DriverSchema = new Schema<IDriver>({
  name: {
    type: String,
    required: true
  },
  // --- CAMPOS AÑADIDOS ---
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    select: false // No devolver la contraseña en las consultas por defecto
  },
  // --- FIN DE CAMPOS AÑADIDOS ---
  location: {
    type: PointSchema,
    required: true,
    index: '2dsphere'
  },
  isAvailable: {
    type: Boolean,
    default: true
  }
});

const Driver = model<IDriver>('Driver', DriverSchema);
export default Driver;