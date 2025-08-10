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
router.post('/register/user', async (req: Request, res: Response): Promise<void> => {
    try {
        const { name, email, password, phoneNumber } = req.body;

        if (!name || !email || !password || !phoneNumber) {
            res.status(400).send({ error: 'Todos los campos son requeridos.' });
            return
        }

        let user = await User.findOne({ email });
        if (user) {
            res.status(400).send({ error: 'El correo electrónico ya está en uso.' });
            return
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        user = new User({ name, email, password: hashedPassword });
        await user.save();

        const token = generateToken(user.id, 'user');
        res.status(201).send({ token, role: 'user' });

    } catch (error: any) {
        res.status(500).send({ error: 'Error en el servidor al registrar usuario.' });
    }
});

/**
 * @route   POST /api/auth/register/driver
 * @desc    Registrar un nuevo conductor
 * @body    { "name": "string", "email": "string", "password": "string", "location": { "lat": number, "lng": number } }
 */
// In your /register/driver endpoint
router.post('/register/driver', async (req: Request, res: Response): Promise<void> => {
    try {
        // Note: 'location' is removed from required fields
        const { name, email, password, phoneNumber } = req.body;

        // Adjust the validation
        if (!name || !email || !password || !phoneNumber) {
            res.status(400).send({ error: 'Todos los campos son requeridos.', data: req.body });
            return
        }

        // ... existing logic to check for user, hash password ...
         const salt = await bcrypt.genSalt(10);
         const hashedPassword = await bcrypt.hash(password, salt);

        // Create the driver without a location initially
        const driver = new Driver({
            name: name, // Match frontend field name
            email,
            password: hashedPassword,
            phoneNumber, // Add this field
            // Location is not set here
        });
        await driver.save();

        const token = generateToken(driver.id, 'driver');
        res.status(201).send({ token, role: 'driver' });

    } catch (error: any) {
        res.status(500).send({ error: 'Error en el servidor al registrar conductor.', msg: error });
    }
});


// --- RUTA DE LOGIN ---

/**
 * @route   POST /api/auth/login
 * @desc    Iniciar sesión para pasajeros o conductores
 * @body    { "email": "string", "password": "string", "role": "user" | "driver" }
 */
// A better login endpoint
router.post('/login', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body; // No 'role' from the request

        if (!email || !password) {
            res.status(400).send({ error: 'Email and password are required.' });
            return;
        }

        // 1. First, check if they are a regular user (rider)
        let account = await User.findOne({ email }).select('+password');
        let role : 'user' | 'driver' = 'user'; // Assume 'user' role first

        // 2. If not found as a user, check if they are a driver
        if (!account) {
            account = await Driver.findOne({ email }).select('+password');
            role = 'driver'; // It's a driver account
        }

        // 3. If not found in either collection, the credentials are bad
        if (!account) {
            res.status(401).send({ error: 'Invalid credentials.' });
            return;
        }

        // 4. Now, compare the password for the found account
        const isMatch = await bcrypt.compare(password, account.password);
        if (!isMatch) {
            res.status(401).send({ error: 'Invalid credentials.' });
            return
        }

        // 5. Generate a token with the role the backend discovered
        const token = generateToken(account.id, role);
        res.status(200).send({ token, role }); // You can also send the role back

    } catch (error: any) {
        res.status(500).send({ error: 'Server error during login.' });
    }
});

export default router;