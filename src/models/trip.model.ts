import mongoose, { Schema, model, Document } from 'mongoose';

// Interfaz para la estructura de un punto GeoJSON
interface IPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitud, latitud]
}

export interface ITrip extends Document {
  riderId: mongoose.Types.ObjectId; // Estandarizado a ObjectId
  driverId: mongoose.Types.ObjectId | null;
  pickupLocation: IPoint; // Usando GeoJSON
  dropoffLocation: IPoint; // Usando GeoJSON
  pickupName: string | null;
  destinationName: string | null;
  userIndications: string | null;
  status: 'REQUESTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  createdAt: Date;
  updatedAt: Date;
  cancelledBy?: 'user' | 'driver'; // Quién canceló
  cancellationFee?: number; // Monto de la tarifa de cancelación
}

// 1. Definimos un esquema para el formato GeoJSON Point
const PointSchema = new Schema<IPoint>({
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

const TripSchema = new Schema<ITrip>({
  // 2. Estandarizamos el riderId a ObjectId para mantener consistencia
  riderId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', // Asume que tienes un modelo 'User' para los pasajeros
    required: true,
    index: true // 3. Añadimos un índice para búsquedas rápidas de historial
  },
  driverId: { 
    type: Schema.Types.ObjectId, 
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

const Trip = model<ITrip>('Trip', TripSchema);
export default Trip;