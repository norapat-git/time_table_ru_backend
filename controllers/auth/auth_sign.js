const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || process.env.secrete_id || 'ru_timetable_secret_key_2026';
const JWT_EXPIRES_IN = '1h';

class AuthenticateToken {
    /**
     * Helper to sign a JWT token for an authenticated user
     */
    static signToken(userPayload, expiresIn = JWT_EXPIRES_IN) {
        return jwt.sign(userPayload, JWT_SECRET, { expiresIn });
    }

    /**
     * Express Middleware: Verify Bearer JWT Token in Authorization header
     */
    static verifyToken(req, res, next) {
        const authHeader = req.headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized Access: ไม่พบ Bearer Token ในคำขอ'
            });
        }

        const token = authHeader.replace(/^Bearer\s+/, '').trim();

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized Access: Token ว่างเปล่า'
            });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            req.decoded = decoded; // for backward compatibility
            next();
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    isExpired: true,
                    message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง'
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Unauthorized Access: Token ไม่ถูกต้องหรือไม่ได้รับอนุญาต'
            });
        }
    }

    // Aliases for compatibility
    static verify_mid(req, res, next) {
        return AuthenticateToken.verifyToken(req, res, next);
    }
}

module.exports = {
    AuthenticateToken,
    authenticateSignToken: AuthenticateToken,
    verifyToken: AuthenticateToken.verifyToken,
    signToken: AuthenticateToken.signToken,
    JWT_SECRET,
};
