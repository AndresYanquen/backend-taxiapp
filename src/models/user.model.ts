import { Schema, model, Document } from 'mongoose';

// Interface para el documento del Usuario/Pasajero
export interface IUser extends Document {
  name: string;
  email: string;
  password?: string; // El password es opcional al traerlo de la DB por seguridad
}

const UserSchema = new Schema<IUser>({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true, // Cada email debe ser único
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    select: false // Por defecto, no incluir el password en las consultas
  }
});

const User = model<IUser>('User', UserSchema);
export default User;

