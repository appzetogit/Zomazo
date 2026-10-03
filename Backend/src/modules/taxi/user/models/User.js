import mongoose from 'mongoose';
import { FoodUser as PlatformUser } from '../../../../core/users/user.model.js';

/*
 * Taxi's customers are rows of the shared `users` collection, and this is the
 * platform's one user schema (core/users/user.model.js) under taxi's model name.
 * Taxi's own fields -- password, deletion, current ride -- are declared there.
 *
 * Same schema object, not a copy, so taxi writes run the platform's hooks too
 * (phoneLast10 stays right when taxi changes a number).
 */
const UserModel = mongoose.models.TaxiUser || mongoose.model('TaxiUser', PlatformUser.schema);

export const User = UserModel;
export const FoodUser = UserModel;
