import mongoose, { Schema, Document } from 'mongoose';

interface IPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface ITrip extends Document {
  riderId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId | null;
  pickupLocation: IPoint; // Usando GeoJSON
  dropoffLocation: IPoint; // Usando GeoJSON
  pickupName: string | null;
  destinationName: string | null;
  userIndications: string | null;
  status: 'REQUESTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  
  // Tiempos Clave
  driverArrivalTime?: Date;
  tripStartTime?: Date;
  tripEndTime?: Date;
  createdAt: Date;
  updatedAt: Date;

  // Detalles de Ruta
  distance?: number; // en metros
  duration?: number; // en segundos
  routePolyline?: string;

  // Finanzas
  estimatedFare?: number;
  actualFare?: number;
  cancellationFee?: number;
  paymentMethodId?: mongoose.Types.ObjectId;
  paymentStatus: 'pending' | 'succeeded' | 'failed';
  transactionId?: string;
  
  // Cancelación
  cancelledBy?: 'user' | 'driver' | 'platform';
  cancellationReason?: string;

  // Calificaciones
  riderRatingOfDriver?: number;
  driverRatingOfRider?: number;
  riderFeedback?: string;
}


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
  riderId: { 
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  driverId: { type: Schema.Types.ObjectId,
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
  destinationName: { type: String, default: null, required: false},
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
  paymentMethodId: { type: Schema.Types.ObjectId, ref: 'PaymentMethod', required: false },
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

const Trip = mongoose.model<ITrip>('Trip', TripSchema);
export default Trip;