// src/types/express/index.d.ts

// Define the structure of the user payload you attach in your middleware
interface UserPayload {
  id: string;
  role: string;
}

// Use module declaration to add the 'user' property to the Express Request interface
declare namespace Express {
  export interface Request {
    user?: UserPayload; // 'user' is optional as it only exists after the auth middleware
  }
}