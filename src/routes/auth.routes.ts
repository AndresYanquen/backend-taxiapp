import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/user.model';
import Driver from '../models/driver.model';

const router = Router();

// --- FUNCIÓN AUXILIAR PARA GENERAR TOKENS ---
const generateToken = (id: string, role: 'user' | 'driver') => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET!, {
        expiresIn: '30d', // El token expirará en 30 días
    });
};

// --- RUTAS DE REGISTRO ---

/**
 * @route   POST /api/auth/register/user
 * @desc    Registrar un nuevo pasajero
 * @body    { "name": "string", "email": "string", "password": "string" }
 */
router.post('/register/user', async (req: Request, res: Response) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).send({ error: 'Todos los campos son requeridos.' });
        }

        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).send({ error: 'El correo electrónico ya está en uso.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({ name, email, password: hashedPassword });
        await user.save();

        const token = generateToken(user.id, 'user');
        res.status(201).send({ token });

    } catch (error: any) {
        res.status(500).send({ error: 'Error en el servidor al registrar usuario.' });
    }
});

/**
 * @route   POST /api/auth/register/driver
 * @desc    Registrar un nuevo conductor
 * @body    { "name": "string", "email": "string", "password": "string", "location": { "lat": number, "lng": number } }
 */
router.post('/register/driver', async (req: Request, res: Response) => {
    try {
        const { name, email, password, location } = req.body;

        if (!name || !email || !password || !location) {
            return res.status(400).send({ error: 'Todos los campos son requeridos.' });
        }

        let driver = await Driver.findOne({ email });
        if (driver) {
            return res.status(400).send({ error: 'El correo electrónico ya está en uso.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        driver = new Driver({
            name,
            email,
            password: hashedPassword,
            location: {
                type: 'Point',
                coordinates: [location.lng, location.lat]
            }
        });
        await driver.save();

        const token = generateToken(driver.id, 'driver');
        res.status(201).send({ token });

    } catch (error: any) {
        res.status(500).send({ error: 'Error en el servidor al registrar conductor.' });
    }
});


// --- RUTA DE LOGIN ---

/**
 * @route   POST /api/auth/login
 * @desc    Iniciar sesión para pasajeros o conductores
 * @body    { "email": "string", "password": "string", "role": "user" | "driver" }
 */
router.post('/login', async (req: Request, res: Response) => {
    try {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).send({ error: 'Email, contraseña y rol son requeridos.' });
        }

        let account: any;
        if (role === 'driver') {
            account = await Driver.findOne({ email }).select('+password');
        } else {
            account = await User.findOne({ email }).select('+password');
        }

        if (!account) {
            return res.status(400).send({ error: 'Credenciales inválidas.' });
        }

        const isMatch = await bcrypt.compare(password, account.password);
        if (!isMatch) {
            return res.status(400).send({ error: 'Credenciales inválidas.' });
        }

        const token = generateToken(account.id, role);
        res.status(200).send({ token });

    } catch (error: any) {
        res.status(500).send({ error: 'Error en el servidor al iniciar sesión.' });
    }
});

export default router;