import { Router, Request } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';
import User from '../models/user.model';
import Driver from '../models/driver.model';
import { asyncHandler } from '../utils/asyncHandler';
import { httpErrors } from '../utils/httpErrors';

type Role = 'user' | 'driver';

const router = Router();

const requireFields = (source: Record<string, unknown>, fields: string[]) => {
  const missing = fields.filter((field) => !source[field]);
  if (missing.length > 0) {
    throw httpErrors.badRequest(`Los siguientes campos son requeridos: ${missing.join(', ')}`, {
      missingFields: missing,
    });
  }
};

const generateToken = (
  id: string,
  role: Role,
  name: string,
  expireTime: number | StringValue = '7d'
) => {
  const payload = { id, role, name };
  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    throw httpErrors.internal('JWT secret is not configured.');
  }
  const options: SignOptions = { expiresIn: expireTime };
  return jwt.sign(payload, secretKey, options);
};

router.post(
  '/register/user',
  asyncHandler(async (req, res) => {
    const { firstName, lastName, email, password, phoneNumber } = req.body;

    requireFields(req.body as Record<string, unknown>, ['firstName', 'lastName', 'email', 'password', 'phoneNumber']);

    const existing = await User.findOne({ email });
    if (existing) {
      throw httpErrors.conflict('El correo electrónico ya está en uso.', { email });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      phoneNumber,
    });
    await user.save();

    const token = generateToken(user.id, 'user', `${user.firstName} ${user.lastName}`);
    res.status(201).send({ token, role: 'user' });
  })
);

router.post(
  '/register/driver',
  asyncHandler(async (req, res) => {
    const { firstName, lastName, email, password, phoneNumber } = req.body;

    requireFields(req.body as Record<string, unknown>, ['firstName', 'lastName', 'email', 'password', 'phoneNumber']);

    const existing = await Driver.findOne({ email });
    if (existing) {
      throw httpErrors.conflict('El correo electrónico ya está en uso.', { email });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const driver = new Driver({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      phoneNumber,
    });
    await driver.save();

    const token = generateToken(driver.id, 'driver', `${driver.firstName} ${driver.lastName}`);
    res.status(201).send({ token, role: 'driver' });
  })
);

router.post(
  '/login',
  asyncHandler(async (req: Request, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw httpErrors.badRequest('Email y clave son requeridos', {
        bodyKeys: Object.keys(req.body ?? {}),
      });
    }

    let account = await User.findOne({ email }).select('+password');
    let role: Role = 'user';

    if (!account) {
      account = await Driver.findOne({ email }).select('+password');
      role = 'driver';
    }

    if (!account) {
      throw httpErrors.unauthorized('Credenciales inválidas.', { email });
    }

    const isMatch = await bcrypt.compare(password, account.password);
    if (!isMatch) {
      throw httpErrors.unauthorized('Credenciales inválidas.', { email });
    }

    const name = account.firstName;
    const token = generateToken(account.id, role, name);
    res.status(200).send({ token, role });
  })
);

export default router;
