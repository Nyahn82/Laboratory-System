import { z } from 'zod';
import { ROLE_CODES, USER_STATUSES } from './constants.js';

const email = z.string().trim().email().max(255);
const password = z.string().min(1).max(128);
export const strongPassword = z.string().min(12).max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');
const roleCode = z.enum(ROLE_CODES);
const userStatus = z.enum(Object.values(USER_STATUSES));

export const loginSchema = z.object({ email, password }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(32).max(512).optional() }).strict().default({});
export const logoutSchema = refreshSchema;
export const passwordChangeSchema = z.object({
  currentPassword: password,
  newPassword: strongPassword,
}).strict().refine((value) => value.currentPassword !== value.newPassword, {
  message: 'New password must differ from the current password',
  path: ['newPassword'],
});
export const passwordResetRequestSchema = z.object({ email }).strict();
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(32).max(512),
  newPassword: strongPassword,
}).strict();

export const createUserSchema = z.object({
  email,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  password: strongPassword,
  patientId: z.string().trim().min(1).max(64).nullable().optional(),
  status: userStatus.default(USER_STATUSES.ACTIVE),
  mustChangePassword: z.boolean().default(true),
  roleCodes: z.array(roleCode).min(1).transform((roles) => [...new Set(roles)]),
}).strict();

export const updateUserSchema = z.object({
  email: email.optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  patientId: z.string().trim().min(1).max(64).nullable().optional(),
  mustChangePassword: z.boolean().optional(),
  roleCodes: z.array(roleCode).min(1).transform((roles) => [...new Set(roles)]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const userStatusSchema = z.object({ status: userStatus }).strict();

export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: userStatus.optional(),
  role: roleCode.optional(),
}).strict();
