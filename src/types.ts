export type ProjectionKind = 'skeletal' | 'wedge' | 'newman' | 'sawhorse' | 'fischer';
export type ViewMode = '3d' | '2d' | 'split';
export interface Candidate {
  name: string; category: 'organic' | 'inorganic'; reason: string; rank: number;
  cid: number | null; formula: string | null; verified: boolean; verification_note?: string;
  source_label?: string;
}
export interface Identification { clarification: string | null; candidates: Candidate[]; warnings: string[] }
export interface Compound {
  cid: number; name: string; iupac: string | null; formula: string | null;
  properties: Record<string, string | number | undefined>; source: string;
  source_label?: string;
  sources?: { label: string; url: string }[];
  computed_fields?: string[];
  record_note?: string;
  forms?: { cid: number; label: string; form: string }[];
  form_label?: string | null;
}
export interface Structures {
  sdf: string | null; elements: string[]; disconnected: boolean; warnings: string[];
  unavailable_reason: string | null;
  projections: Record<ProjectionKind, { enabled: boolean; reason: string | null }>;
  bonds: { id: number; atoms: number[]; label: string }[];
}
export interface Projection { svg: string; caption: string; highlight: number[] }
export interface ChatMessage { role: 'user' | 'model'; text: string }
