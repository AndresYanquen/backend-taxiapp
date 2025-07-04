import { Schema, model, Document } from 'mongoose';

export interface ITrip extends Document {
  riderId: string;
  driverId: Schema.Types.ObjectId | null;
  pickupLocation: { lat: number; lng: number; };
  dropoffLocation: { lat: number; lng: number; };
  status: 'REQUESTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

const TripSchema = new Schema<ITrip>({
  riderId: { type: String, required: true },
  driverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
  pickupLocation: { lat: Number, lng: Number },
  dropoffLocation: { lat: Number, lng: Number },
  status: {
    type: String,
    enum: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'REQUESTED'
  }
});

const Trip = model<ITrip>('Trip', TripSchema);
export default Trip;