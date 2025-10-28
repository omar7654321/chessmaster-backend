const jwt = require('jsonwebtoken');
const config = require('./config');

function signAccessToken({ userId }) {
  if (!userId) throw new Error('userId is required to sign token');
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn || '7d',
  });
}

function verifyAccessToken(token) {
  if (!token) throw new Error('Missing token');
  return jwt.verify(token, config.jwtSecret);
}

function parseAuthorizationHeader(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const [scheme, token] = headerValue.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  return token || null;
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  parseAuthorizationHeader,
};
