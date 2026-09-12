import { ValidLocation } from '../types';

/**
 * Strict single source of truth for valid inventory locations across the application.
 * Exactly 4 locations allowed. No placeholders, no 5th or 6th locations.
 */
export const VALID_LOCATIONS: readonly ValidLocation[] = [
  'CHEMICAL ROOM',
  'CHILLAX',
  'MAKER STUDIO',
  'STORE 1',
] as const;

export function isValidLocation(location: string): location is ValidLocation {
  return VALID_LOCATIONS.includes(location as ValidLocation);
}
