const jwt = require('jsonwebtoken');
const { config } = require('../../../config/env.js');

// The platform's secrets, from the platform's config -- not re-read from
// process.env. One admin login serves every panel, so SP must sign and verify
// with exactly the key master does. Reading the env vars here missed master's
// fallback: with them unset (dev, tests) master generated a key and SP signed
// with `undefined`, so every SP sign-in failed. Production requires them set.
const ACCESS_SECRET = () => config.jwtAccessSecret;
const REFRESH_SECRET = () => config.jwtRefreshSecret;

/**
 * Generate access token
 * @param {Object} payload - Token payload
 * @returns {string} - JWT token
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, ACCESS_SECRET(), {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

/**
 * Generate refresh token
 * @param {Object} payload - Token payload
 * @returns {string} - JWT refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, REFRESH_SECRET(), {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d'
  });
};

/**
 * Generate token pair (access + refresh)
 * @param {Object} payload - Token payload
 * @returns {Object} - Token pair
 */
const generateTokenPair = (payload) => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload)
  };
};

/**
 * Verify access token
 * @param {string} token - JWT token
 * @returns {Object} - Decoded token
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, ACCESS_SECRET());
};

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {Object} - Decoded token
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, REFRESH_SECRET());
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,

  /**
   * Generate temporary verification token for signup flow
   * @param {string} phone - Verified phone number
   * @returns {string} - JWT verification token
   */
  generateVerificationToken: (phone) => {
    return jwt.sign({ phone, type: 'verification' }, ACCESS_SECRET(), {
      expiresIn: '15m'
    });
  },

  /**
   * Verify verification token
   * @param {string} token - JWT verification token
   * @returns {string|null} - Phone number if valid, null otherwise
   */
  verifyVerificationToken: (token) => {
    try {
      const decoded = jwt.verify(token, ACCESS_SECRET());
      if (decoded.type !== 'verification') return null;
      return decoded.phone;
    } catch (error) {
      return null;
    }
  }
};

