const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // The customer's ONE platform identity (shared `users` collection). Stamped at
  // registration by core/identity/identityLink.service.js and backfilled by
  // scripts/link-user-identities.js. Replaces phone-suffix matching as the way to
  // say "this sp_user and that platform user are the same person".
  platformUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FoodUser',
    default: null,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true // Allows multiple null values
  },
  phone: {
    type: String,
    required: [true, 'Please provide a phone number'],
    unique: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  password: {
    type: String,
    select: false
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  profilePhoto: {
    type: String,
    default: null
  },
  // ENFORCED POLICY: Only 1 address allowed. If user changes it, we replace.
  addresses: [{
    type: {
      type: String, // home, work, other
      default: 'home'
    },
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    pincode: String,
    landmark: String,
    isDefault: {
      type: Boolean,
      default: false
    }
  }],
  wallet: {
    balance: {
      type: Number,
      default: 0
    },
    penalty: {
      type: Number,
      default: 0
    }
  },
  plans: {
    isActive: {
      type: Boolean,
      default: false
    },
    name: {
      type: String,
      default: null
    },
    expiry: {
      type: Date,
      default: null
    },
    price: {
      type: Number,
      default: 0
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Settings
  settings: {
    notifications: {
      type: Boolean,
      default: true
    },
    language: {
      type: String,
      default: 'en'
    }
  },
  // Statistics
  totalBookings: {
    type: Number,
    default: 0
  },
  completedBookings: {
    type: Number,
    default: 0
  },
  cancelledBookings: {
    type: Number,
    default: 0
  },

  // FCM Push Notification Tokens
  fcmTokens: {
    type: [String],
    default: []
  },
  fcmTokenMobile: {
    type: [String],
    default: []
  },
  loginSessionId: {
    type: String,
    default: null
  },

  // Referral (services/referralService.js). The code is made on first ask, so
  // accounts that never share one never get one.
  referralCode: {
    type: String,
    trim: true,
    uppercase: true,
    unique: true,
    sparse: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPUser',
    default: null
  },
  // Rewarded referrals, counted against the Master per-customer limit.
  referralCount: {
    type: Number,
    default: 0,
    min: 0
  },

  // Services the customer saved to book again (routes/user-routes/favourite.routes.js).
  // Oldest first; capped there.
  favouriteServices: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SPUserService' }],
    default: []
  }

}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// The old customer rows, read only by the merge (core/identity/spCustomer.js,
// scripts/migrations/mergeSpUsers.mjs). No wallet bridge: nothing writes them.
const LegacySPUser = mongoose.models.SPLegacyUser || mongoose.model('SPLegacyUser', userSchema.clone(), 'sp_users');

/*
 * Since the sp_users merge a Services customer IS their platform account
 * (`users`); this model is their Services profile, sp_profiles, under the SAME
 * _id: what only Services keeps (the cancellation-fee bucket, plans, settings,
 * booking stats, favourites, its address list, the session id and the
 * Services app's own password). Name and phone are kept here too, as Services
 * screens read them. A new profile takes the platform account's _id for its
 * phone -- found, or made -- so every path that creates a customer (the
 * Services app's own sign-up, the platform bridge, seeds) stays one person.
 */
userSchema.pre('validate', async function adoptPlatformId() {
  if (!this.isNew || this.$locals.platformIdSet) return;
  const { spCustomers } = await import('../../../core/identity/spCustomer.js');
  const account = await spCustomers.customerForPhone(this.phone, { name: this.name });
  if (!account?._id) throw new Error('Could not find or make the platform account for this phone');
  this._id = account._id;
  this.platformUserId = account._id;
  this.$locals.platformIdSet = true;
  await spCustomers.markJoined(account._id);
});

// The Services admin's block (and soft delete) is this profile's isActive; the
// platform account carries it as spBlocked, so other services and the
// platform's screens see it -- without switching the account off everywhere.
userSchema.post('save', async function mirrorServicesBlock(doc) {
  if (!doc.$locals.wasActiveModified) return;
  await mongoose.connection.collection('users').updateOne(
    { _id: doc._id },
    { $set: { spBlocked: doc.isActive === false } },
  );
});
userSchema.pre('save', function noteActiveChange() {
  this.$locals.wasActiveModified = this.isModified('isActive');
});

// The customer's wallet balance is their ONE wallet (food_user_wallets),
// shared with Food, Rides and Quick & Medical -- utils/sharedWalletBridge.js.
require('../utils/sharedWalletBridge').attachSharedWallet(userSchema);

module.exports = mongoose.models.SPUser || mongoose.model('SPUser', userSchema, 'sp_profiles');
module.exports.LegacySPUser = LegacySPUser;

