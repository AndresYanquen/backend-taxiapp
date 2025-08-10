"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const user_model_1 = __importDefault(require("../models/user.model"));
const driver_model_1 = __importDefault(require("../models/driver.model"));
const router = (0, express_1.Router)();
// --- FUNCIÓN AUXILIAR PARA GENERAR TOKENS ---
const generateToken = (id, role) => {
    return jsonwebtoken_1.default.sign({ id, role }, process.env.JWT_SECRET, {
        expiresIn: '30d', // El token expirará en 30 días
    });
};
// --- RUTAS DE REGISTRO ---
/**
 * @route   POST /api/auth/register/user
 * @desc    Registrar un nuevo pasajero
 * @body    { "name": "string", "email": "string", "password": "string" }
 */
router.post('/register/user', async (req, res) => {
    try {
        const { name, email, password, phoneNumber } = req.body;
        if (!name || !email || !password || !phoneNumber) {
            return res.status(400).send({ error: 'Todos los campos son requeridos.' });
        }
        let user = await user_model_1.default.findOne({ email });
        if (user) {
            return res.status(400).send({ error: 'El correo electrónico ya está en uso.' });
        }
        const salt = await bcryptjs_1.default.genSalt(10);
        const hashedPassword = await bcryptjs_1.default.hash(password, salt);
        user = new user_model_1.default({ name, email, password: hashedPassword });
        await user.save();
        const token = generateToken(user.id, 'user');
        res.status(201).send({ token, role: 'user' });
    }
    catch (error) {
        res.status(500).send({ error: 'Error en el servidor al registrar usuario.' });
    }
});
/**
 * @route   POST /api/auth/register/driver
 * @desc    Registrar un nuevo conductor
 * @body    { "name": "string", "email": "string", "password": "string", "location": { "lat": number, "lng": number } }
 */
// In your /register/driver endpoint
router.post('/register/driver', async (req, res) => {
    try {
        // Note: 'location' is removed from required fields
        const { name, email, password, phoneNumber } = req.body;
        // Adjust the validation
        if (!name || !email || !password || !phoneNumber) {
            return res.status(400).send({ error: 'Todos los campos son requeridos.', data: req.body });
        }
        // ... existing logic to check for user, hash password ...
        const salt = await bcryptjs_1.default.genSalt(10);
        const hashedPassword = await bcryptjs_1.default.hash(password, salt);
        // Create the driver without a location initially
        const driver = new driver_model_1.default({
            name: name, // Match frontend field name
            email,
            password: hashedPassword,
            phoneNumber, // Add this field
            // Location is not set here
        });
        await driver.save();
        const token = generateToken(driver.id, 'driver');
        res.status(201).send({ token, role: 'driver' });
    }
    catch (error) {
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
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body; // No 'role' from the request
        if (!email || !password) {
            return res.status(400).send({ error: 'Email and password are required.' });
        }
        // 1. First, check if they are a regular user (rider)
        let account = await user_model_1.default.findOne({ email }).select('+password');
        let role = 'user'; // Assume 'user' role first
        // 2. If not found as a user, check if they are a driver
        if (!account) {
            account = await driver_model_1.default.findOne({ email }).select('+password');
            role = 'driver'; // It's a driver account
        }
        // 3. If not found in either collection, the credentials are bad
        if (!account) {
            return res.status(401).send({ error: 'Invalid credentials.' });
        }
        // 4. Now, compare the password for the found account
        const isMatch = await bcryptjs_1.default.compare(password, account.password);
        if (!isMatch) {
            return res.status(401).send({ error: 'Invalid credentials.' });
        }
        // 5. Generate a token with the role the backend discovered
        const token = generateToken(account.id, role);
        res.status(200).send({ token, role }); // You can also send the role back
    }
    catch (error) {
        res.status(500).send({ error: 'Server error during login.' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.routes.js.map