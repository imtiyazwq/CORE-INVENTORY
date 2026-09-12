export const VALID_LOCATIONS = [
  'STORE 1',
  'CHILLAX',
  'CHEMICAL ROOM',
  'MAKER STUDIO',
] as const;

export type ValidLocation = (typeof VALID_LOCATIONS)[number];
