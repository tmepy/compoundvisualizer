declare module '3dmol' {
  export function createViewer(element: HTMLElement, options: Record<string, unknown>): unknown;
  export const elementColors: { Jmol: Record<string, number> };
}
