/**
 * STUB (RED). Replaced in the GREEN commit; returns inputs unchanged so the tests fail on assertions.
 */
export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia";
export const DEFICIENCIES: readonly Deficiency[] = ["protanopia", "deuteranopia", "tritanopia"];
export const TEXT_FLOOR = 10;
export const WASH_FLOOR = 2.3;
export const simulateProtanopia = (hex: string): string => hex;
export const simulateDeuteranopia = (hex: string): string => hex;
export const simulateTritanopia = (hex: string): string => hex;
export const simulate = (hex: string, _d: Deficiency): string => hex;
export const deltaE = (_a: string, _b: string): number => 0;
export const separation = (_a: string, _b: string, _d: Deficiency): number => 0;
export const distinguishable = (_a: string, _b: string, _d: Deficiency, _floor: number): boolean => false;
