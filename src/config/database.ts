import mongoose from 'mongoose';

export const connectDB = async () => {
    try {
        // Usamos el Non-null assertion operator (!) porque confiamos en que MONGO_URI estará en .env
        await mongoose.connect(process.env.MONGO_URI!);
        console.log('MongoDB connected successfully');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        // Si la conexión falla, terminamos el proceso del servidor.
        process.exit(1);
    }
};