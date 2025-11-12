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
const asyncHandler_1 = require("../utils/asyncHandler");
const httpErrors_1 = require("../utils/httpErrors");
const router = (0, express_1.Router)();
const requireFields = (source, fields) => {
    const missing = fields.filter((field) => !source[field]);
    if (missing.length > 0) {
        throw httpErrors_1.httpErrors.badRequest(`Los siguientes campos son requeridos: ${missing.join(', ')}`, {
            missingFields: missing,
        });
    }
};
const generateToken = (id, role, name, expireTime = '1d') => {
    const payload = { id, role, name };
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) {
        throw httpErrors_1.httpErrors.internal('JWT secret is not configured.');
    }
    const options = { expiresIn: expireTime };
    return jsonwebtoken_1.default.sign(payload, secretKey, options);
};
router.post('/register/user', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { firstName, lastName, email, password, phoneNumber } = req.body;
    requireFields(req.body, ['firstName', 'lastName', 'email', 'password', 'phoneNumber']);
    const existing = await user_model_1.default.findOne({ email });
    if (existing) {
        throw httpErrors_1.httpErrors.conflict('El correo electrónico ya está en uso.', { email });
    }
    const salt = await bcryptjs_1.default.genSalt(10);
    const hashedPassword = await bcryptjs_1.default.hash(password, salt);
    const user = new user_model_1.default({
        firstName,
        lastName,
        email,
        password: hashedPassword,
        phoneNumber,
    });
    await user.save();
    const token = generateToken(user.id, 'user', `${user.firstName} ${user.lastName}`);
    res.status(201).send({ token, role: 'user' });
}));
router.post('/register/driver', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { firstName, lastName, email, password, phoneNumber } = req.body;
    requireFields(req.body, ['firstName', 'lastName', 'email', 'password', 'phoneNumber']);
    const existing = await driver_model_1.default.findOne({ email });
    if (existing) {
        throw httpErrors_1.httpErrors.conflict('El correo electrónico ya está en uso.', { email });
    }
    const salt = await bcryptjs_1.default.genSalt(10);
    const hashedPassword = await bcryptjs_1.default.hash(password, salt);
    const driver = new driver_model_1.default({
        firstName,
        lastName,
        email,
        password: hashedPassword,
        phoneNumber,
    });
    await driver.save();
    const token = generateToken(driver.id, 'driver', `${driver.firstName} ${driver.lastName}`);
    res.status(201).send({ token, role: 'driver' });
}));
router.post('/login', (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        throw httpErrors_1.httpErrors.badRequest('Email y clave son requeridos', {
            bodyKeys: Object.keys(req.body ?? {}),
        });
    }
    let account = await user_model_1.default.findOne({ email }).select('+password');
    let role = 'user';
    if (!account) {
        account = await driver_model_1.default.findOne({ email }).select('+password');
        role = 'driver';
    }
    if (!account) {
        throw httpErrors_1.httpErrors.unauthorized('Credenciales inválidas.', { email });
    }
    const isMatch = await bcryptjs_1.default.compare(password, account.password);
    if (!isMatch) {
        throw httpErrors_1.httpErrors.unauthorized('Credenciales inválidas.', { email });
    }
    const name = account.firstName;
    const token = generateToken(account.id, role, name);
    res.status(200).send({ token, role });
}));
exports.default = router;
//# sourceMappingURL=auth.routes.js.map