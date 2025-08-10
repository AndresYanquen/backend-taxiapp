"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const database_1 = require("./config/database");
const api_routes_1 = require("./routes/api.routes");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const driver_model_1 = __importDefault(require("./models/driver.model"));
// --- Environment and Database Setup ---
dotenv_1.default.config();
(0, database_1.connectDB)();
// --- Security: Validate Environment Variables at Startup ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined in .env file.");
    process.exit(1); // Stop the server if the secret is missing
}
const corsOptions = {
    // Replace with your Vue app's actual URL
    origin: '*',
    // Ensure PATCH and OPTIONS are included in the allowed methods
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // Ensure necessary headers are allowed
    allowedHeaders: ['Content-Type', 'Authorization'],
};
// --- Express App and HTTP Server Setup ---
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/auth', auth_routes_1.default);
app.use((0, cors_1.default)(corsOptions));
const server = http_1.default.createServer(app);
// --- Socket.IO Server Setup ---
const io = new socket_io_1.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
// --- Main Socket Connection Handler ---
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    try {
        // 1. Authenticate the socket immediately
        const token = socket.handshake.auth.token;
        if (!token) {
            console.log(`Socket ${socket.id} disconnected: No token provided.`);
            return socket.disconnect();
        }
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        console.log(`Socket ${socket.id} authenticated as ${decoded.role} [${decoded.id}]`);
        // 2. Register event listeners AFTER successful authentication
        if (decoded.role === 'driver') {
            const driverId = decoded.id;
            // Update driver's socket ID for direct communication
            driver_model_1.default.findByIdAndUpdate(driverId, { socketId: socket.id }).exec();
            socket.on('update-location', async (location) => {
                if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number')
                    return;
                console.log('driver has updated his location to', location.lat, location.lng);
                await driver_model_1.default.findByIdAndUpdate(driverId, {
                    location: { type: 'Point', coordinates: [location.lng, location.lat] }
                });
            });
        }
        else if (decoded.role === 'user') {
            socket.on('joinRideRoom', (tripId) => {
                if (tripId) {
                    const roomName = `trip-${tripId}`; // Use consistent room naming
                    socket.join(roomName);
                    console.log(`User ${decoded.id} joined room: ${roomName}`);
                }
            });
        }
        // 3. Handle disconnect logic for authenticated users
        socket.on('disconnect', () => {
            console.log(`Socket ${socket} with role '${socket.data.role}' disconnected.`);
            // --- MODIFICATION 2: Check the role before querying the database ---
            const token = socket.handshake.auth.token;
            if (!token) {
                console.log(`Socket ${socket.id} disconnected: No token provided.`);
                return socket.disconnect();
            }
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            if (decoded.role === 'driver') {
                driver_model_1.default.findOneAndUpdate({ socketId: socket.id, isAvailable: true }, { isAvailable: false, socketId: null }, { new: true })
                    .then(driver => {
                    if (driver) {
                        console.log(`Driver ${driver.name} was set to offline due to disconnection.`);
                    }
                })
                    .catch(err => {
                    console.error('Error updating driver status on disconnect:', err);
                });
            }
        });
    }
    catch (error) {
        console.log(`Socket ${socket.id} auth failed, disconnecting:`, error.message);
        socket.disconnect();
    }
});
// --- API Routes and Server Start ---
app.use('/api', (0, api_routes_1.createApiRoutes)(io));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map