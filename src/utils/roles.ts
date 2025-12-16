import { ROLES } from '../constants/roles.js';

export type Role = typeof ROLES[keyof typeof ROLES];

export function hasRole(role: string, allowed: readonly Role[]) {
  return allowed.includes(role as Role);
}
