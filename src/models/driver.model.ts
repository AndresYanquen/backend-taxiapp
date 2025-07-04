import { Schema, model, Document } from 'mongoose';

// Interface para el sub-documento de punto geoespacial
export interface IPoint extends Document {
  type: 'Point';
  coordinates: [number, number]; // Formato [longitud, latitud]
}

// Interface para el documento del Conductor
export interface IDriver extends Document {
  name: string;
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
  location: {
    type: PointSchema,
    required: true,
    // ¡MUY IMPORTANTE! Creamos el índice geoespacial '2dsphere'.
    index: '2dsphere'
  },
  isAvailable: {
    type: Boolean,
    default: true
  }
});

const Driver = model<IDriver>('Driver', DriverSchema);
export default Driver;