import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
export function signAccessToken(userId, sessionId, role) {
    return jwt.sign({ sid: sessionId, role }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m` });
}
export function signRefreshToken(userId, sessionId, role) {
    return jwt.sign({ sid: sessionId, role }, env.JWT_REFRESH_SECRET, { subject: userId, expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d` });
}
export function verifyRefreshToken(token) {
    return jwt.verify(token, env.JWT_REFRESH_SECRET);
}
